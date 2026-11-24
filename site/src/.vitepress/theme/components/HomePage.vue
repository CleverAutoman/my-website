<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import Icon from './Icon.vue'
import { profile, stackLayers, courses, experiences, projects, posts, type LaneId, type LayerId } from '../data'

const isExternal = (h: string) => /^https?:/.test(h)
const to = (h: string) => (isExternal(h) ? h : withBase(h))
const ext = (h: string) => (isExternal(h) ? { target: '_blank', rel: 'noreferrer noopener' } : {})
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const projId = (name: string) => `proj-${slug(name)}`
const xpId = (x: { org: string; role: string }) => `xp-${slug(`${x.org} ${x.role}`)}`
const postId = (href: string) => `post-${slug(href)}`

// 假的 commit hash：对字符串做 FNV-1a，保证每次构建一致
const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 7)
}

const featured = projects.filter((p) => p.featured)
// 最近一段已经发生的经历（git log 里的 HEAD）
const firstShipped = experiences.find((x) => !x.upcoming)
const linkedin = profile.socials.find((x) => x.icon === 'linkedin')!.href
const github = profile.socials.find((x) => x.icon === 'github')!.href
const others = projects.filter((p) => !p.featured)

const consoleRows: [string, string][] = [
  ['role', 'swe @ tiktok · incoming'],
  ['focus', 'agents · llm eval · serving'],
  ['stack', 'Go · Python · gRPC · Kafka'],
  ['data', 'Postgres · Redis · AWS'],
  ['systems', 'os · db · risc-v · networking']
]

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- 技术栈层 → 证据联动 ---------- */
interface Evidence {
  id: string
  label: string
  lane?: LaneId
}
const evidence = computed(() => {
  const map: Record<LayerId, Evidence[]> = { L1: [], L2: [], L3: [] }
  for (const p of projects) if (p.layer) map[p.layer].push({ id: projId(p.name), label: p.name })
  for (const x of experiences) if (x.layer) map[x.layer].push({ id: xpId(x), label: `${x.org} · ${x.role}`, lane: x.lane })
  for (const p of posts) if (p.layer) map[p.layer].push({ id: postId(p.href), label: p.title, lane: p.lane })
  return map
})
const activeLayer = ref<LayerId | null>(null)
const activeLane = ref<LaneId | null>(null)
const laneName = (id: LaneId) => ({ agent: 'agent', serving: 'serving' })[id]
const pulse = ref<string | null>(null)
let pulseTimer: number | undefined

function jump(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
  pulse.value = null
  window.clearTimeout(pulseTimer)
  requestAnimationFrame(() => (pulse.value = id))
  pulseTimer = window.setTimeout(() => (pulse.value = null), 2000)
}
const stateOf = (id: string, layer?: LayerId) => ({
  lit: !!layer && activeLayer.value === layer,
  pulse: pulse.value === id
})

onBeforeUnmount(() => {
  window.clearTimeout(pulseTimer)
})
</script>

<template>
  <div class="home">
    <!-- Hero -->
    <section class="hero">
      <div class="hero-bg" aria-hidden="true" />
      <div class="wrap hero-inner">
        <div class="hero-copy">
          <p class="prompt">
            <span class="p-user">{{ profile.handle }}@infra</span><span class="p-dim">:</span><span class="p-path">~</span
            ><span class="p-dim">$</span> whoami
          </p>
          <h1 class="name">{{ profile.name }}</h1>
          <p class="lead">
            Software engineer building <span class="hl">AI infrastructure</span>: multi-agent orchestration, LLM
            evaluation, and the distributed systems underneath.
          </p>
          <p class="sub">
            Incoming SWE at TikTok, where as an intern I built a multi-agent LLM evaluation framework in Go. Backend
            experience from Meituan, systems foundations from OS kernels and database engines. Learning LLM inference
            in public.
          </p>
          <div class="socials">
            <a
              v-for="s in profile.socials"
              :key="s.label"
              class="social"
              :href="s.href"
              :aria-label="s.label"
              :title="s.label"
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon :name="s.icon" :size="18" />
            </a>
          </div>
        </div>

        <div class="console" role="group" aria-label="Profile summary">
          <div class="console-bar">
            <span class="dot" /><span class="dot" /><span class="dot" />
            <span class="console-title">node-status — {{ profile.handle }}-01</span>
          </div>
          <div class="console-body">
            <div class="console-id">
              <img :src="to(profile.avatar)" alt="Illustrated portrait of Chenguang" class="avatar" />
              <div>
                <div class="id-name">{{ profile.handle }}-01</div>
                <div class="id-status"><span class="live" /> online · learning in public</div>
              </div>
            </div>
            <p class="cmd"><span class="p-dim">$</span> infra-status --profile</p>
            <dl class="kv">
              <template v-for="[k, v] in consoleRows" :key="k">
                <dt>{{ k }}</dt>
                <dd>{{ v }}</dd>
              </template>
            </dl>
          </div>
        </div>
      </div>
    </section>

    <!-- Stack: 分层架构图 -->
    <section id="stack" class="section">
      <div class="wrap">
        <header class="sec-head">
          <p class="sec-label">01 · stack</p>
          <h2>The layers I work across</h2>
          <p class="sec-desc">From silicon-adjacent systems up to agents and model serving. Each layer links to the work behind it.</p>
        </header>
        <figure class="stack-fig" aria-label="Layered diagram of the stack I work across">
          <div class="cap">▲ models · agents · LLM apps</div>
          <div
            v-for="l in stackLayers"
            :key="l.id"
            class="tier"
            :data-layer="l.id"
            :class="{ active: activeLayer === l.id }"
            @mouseenter="activeLayer = l.id"
            @mouseleave="activeLayer = null"
            @focusin="activeLayer = l.id"
            @focusout="activeLayer = null"
          >
            <!-- 有 lanes 的层拆成并排的独立框（L3：Agent Infra | Serving Infra） -->
            <div v-if="l.lanes" class="slab-row">
              <div
                v-for="ln in l.lanes"
                :key="ln.id"
                class="slab"
                :class="[ln.state, { active: activeLane === ln.id }]"
                @mouseenter="activeLane = ln.id"
                @mouseleave="activeLane = null"
              >
                <div class="slab-head">
                  <span class="layer-id">{{ l.id }}</span>
                  <span class="layer-name">{{ ln.name }}</span>
                </div>
                <div class="groups">
                  <div v-for="g in ln.groups" :key="g.label" class="group">
                    <span class="g-label">{{ g.label }}</span>
                    <ul class="blocks">
                      <li v-for="it in g.items" :key="it">{{ it }}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="slab">
              <div class="slab-head">
                <span class="layer-id">{{ l.id }}</span>
                <span class="layer-name">{{ l.name }}</span>
              </div>
              <div class="groups">
                <div v-for="g in l.groups" :key="g.label" class="group">
                  <span class="g-label">{{ g.label }}</span>
                  <ul class="blocks">
                    <li v-for="it in g.items" :key="it">{{ it }}</li>
                  </ul>
                </div>
              </div>
            </div>
            <ul class="ev-list" aria-label="Evidence">
              <li v-for="e in evidence[l.id]" :key="e.id">
                <a
                  class="ev"
                  :class="{ dim: activeLane && e.lane && e.lane !== activeLane }"
                  :href="`#${e.id}`"
                  @click.prevent="jump(e.id)"
                >
                  <span v-if="e.lane" class="ev-lane">{{ laneName(e.lane) }}</span>{{ e.label }}
                </a>
              </li>
            </ul>
          </div>
          <div class="base">▼ hardware · CPU · GPU · network</div>
        </figure>
      </div>
    </section>

    <!-- Experience: git log --graph -->
    <section id="experience" class="section">
      <div class="wrap">
        <header class="sec-head">
          <p class="sec-label">02 · experience</p>
          <h2>Where I've shipped</h2>
          <p class="sec-desc mono-desc">$ git log --graph career</p>
        </header>
        <ol class="commits">
          <li
            v-for="x in experiences"
            :id="xpId(x)"
            :key="x.org + x.role"
            class="commit"
            :data-layer="x.layer"
            :class="[{ upcoming: x.upcoming }, stateOf(xpId(x), x.layer)]"
          >
            <div class="rail" aria-hidden="true"><span class="node" /></div>
            <div class="c-body">
              <p class="c-head">
                <template v-if="x.upcoming">
                  <span class="c-word">staged</span> <span class="refs">(not yet committed)</span>
                </template>
                <template v-else>
                  <span class="c-word">commit</span> <span class="c-hash">{{ hash(x.org + x.role) }}</span>
                  <span class="refs"
                    >&nbsp;(<template v-if="x === firstShipped"><span class="ref-head">HEAD -&gt; main</span>, </template
                    ><span class="ref-tag">tag: {{ x.layer }}</span>)</span
                  >
                </template>
              </p>
              <h3 class="c-title">
                {{ x.role }}
                <a class="org" :href="x.orgUrl" target="_blank" rel="noreferrer noopener">@ {{ x.org }}</a>
              </h3>
              <p class="c-date">{{ x.period }} · {{ x.location }}</p>
              <ul v-if="x.bullets.length" class="bullets">
                <li v-for="b in x.bullets" :key="b">{{ b }}</li>
              </ul>
              <p v-if="x.stack.length" class="diffstat">
                <span v-for="t in x.stack" :key="t" class="add">+{{ t }}</span>
              </p>
            </div>
          </li>
          <li class="commit root" data-layer="L1">
            <div class="rail" aria-hidden="true"><span class="node" /></div>
            <div class="c-body">
              <p class="c-head">
                <span class="c-word">commit</span> <span class="c-hash">{{ hash('root') }}</span>
                <span class="refs">&nbsp;(<span class="ref-tag">root</span>)</span>
              </p>
              <h3 class="c-title">init: systems foundations <span class="org">@ UC Berkeley</span></h3>
              <ul class="course-list">
                <li v-for="c in courses" :key="c.code">
                  <span class="add">+{{ c.code }}</span> {{ c.title }}
                </li>
              </ul>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- Projects -->
    <section id="projects" class="section">
      <div class="wrap">
        <header class="sec-head">
          <p class="sec-label">03 · projects</p>
          <h2>Systems I've built</h2>
          <p class="sec-desc">Kernels, storage engines and hardware, measured where it matters.</p>
        </header>

        <div class="featured">
          <article
            v-for="p in featured"
            :id="projId(p.name)"
            :key="p.name"
            class="panel proj proj-featured"
            :data-layer="p.layer"
            :class="stateOf(projId(p.name), p.layer)"
          >
            <div class="proj-top">
              <ul class="chips chips-sm">
                <li v-if="p.layer" class="lbadge">{{ p.layer }}</li>
                <li v-for="s in p.stack" :key="s">{{ s }}</li>
              </ul>
              <h3>{{ p.name }}</h3>
              <p class="proj-summary">{{ p.summary }}</p>
            </div>
            <dl v-if="p.readouts" class="readouts">
              <div v-for="r in p.readouts" :key="r.label" class="readout">
                <dt>{{ r.value }}</dt>
                <dd>{{ r.label }}</dd>
              </div>
            </dl>
            <div class="proj-links">
              <a v-for="l in p.links" :key="l.label" class="plink" :href="to(l.href)" v-bind="ext(l.href)">
                <Icon :name="l.kind" :size="15" /> {{ l.label }}
              </a>
            </div>
          </article>
        </div>

        <div class="others">
          <article
            v-for="p in others"
            :id="projId(p.name)"
            :key="p.name"
            class="panel proj proj-small"
            :data-layer="p.layer"
            :class="stateOf(projId(p.name), p.layer)"
          >
            <a
              v-if="p.image"
              class="thumb"
              :href="p.links[0]?.href ?? undefined"
              target="_blank"
              rel="noreferrer noopener"
              :aria-label="`${p.name} demo`"
            >
              <img :src="to(p.image)" :alt="`${p.name} screenshot`" loading="lazy" />
            </a>
            <div class="proj-body">
              <h3>{{ p.name }}</h3>
              <p class="proj-summary">{{ p.summary }}</p>
              <ul class="chips chips-sm">
                <li v-if="p.layer" class="lbadge">{{ p.layer }}</li>
                <li v-for="s in p.stack" :key="s">{{ s }}</li>
              </ul>
              <div v-if="p.links.length" class="proj-links">
                <a v-for="l in p.links" :key="l.label" class="plink" :href="to(l.href)" v-bind="ext(l.href)">
                  <Icon :name="l.kind" :size="15" /> {{ l.label }}
                </a>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- Writing -->
    <section id="writing" class="section">
      <div class="wrap">
        <header class="sec-head">
          <p class="sec-label">04 · writing</p>
          <h2>Notes and design docs</h2>
          <p class="sec-desc">
            <a class="inline-link" :href="to('/blog/')">All posts <Icon name="arrow" :size="14" /></a>
          </p>
        </header>
        <div class="posts">
          <a
            v-for="(p, i) in posts"
            :id="postId(p.href)"
            :key="p.href"
            class="post"
            :class="[{ 'post-lead': i === 0 }, stateOf(postId(p.href), p.layer)]"
            :data-layer="p.layer"
            :href="to(p.href)"
          >
            <div class="post-meta">
              <span v-if="p.layer" class="lbadge">{{ p.layer }}</span>
              <span class="tag">{{ p.tag }}</span>
              <span v-if="p.status" class="status"><span class="live" /> {{ p.status }}</span>
            </div>
            <h3>{{ p.title }}</h3>
            <p>{{ p.summary }}</p>
            <span class="post-arrow"><Icon name="arrow" :size="18" /></span>
          </a>
        </div>
      </div>
    </section>

    <!-- Contact -->
    <section id="contact" class="section section-last">
      <div class="wrap">
        <div class="panel contact">
          <div>
            <p class="cmd"><span class="p-dim">$</span> ping {{ profile.handle }}</p>
            <h2>Say hi</h2>
            <p class="sec-desc">Happy to talk about AI infra, backend systems, or anything on this site.</p>
          </div>
          <div class="contact-actions">
            <a class="btn btn-primary" :href="linkedin" target="_blank" rel="noreferrer noopener">
              <Icon name="linkedin" :size="16" /> Message on LinkedIn
            </a>
            <a class="btn btn-ghost" :href="github" target="_blank" rel="noreferrer noopener">
              <Icon name="github" :size="16" /> GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  --mono: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
}
.home [data-layer='L3'] {
  --layer-c: var(--vp-c-brand-1);
}
.home [data-layer='L2'] {
  --layer-c: var(--x-blue);
}
.home [data-layer='L1'] {
  --layer-c: var(--x-violet);
}
.wrap {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ---------- hero ---------- */
.hero {
  position: relative;
  padding: 72px 0 88px;
  overflow: hidden;
  border-bottom: 1px solid var(--vp-c-divider);
}
.hero-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--x-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--x-grid) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(ellipse 80% 70% at 60% 40%, #000 30%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse 80% 70% at 60% 40%, #000 30%, transparent 75%);
}
.hero-bg::after {
  content: '';
  position: absolute;
  width: 560px;
  height: 560px;
  right: -120px;
  top: -160px;
  background: radial-gradient(circle, var(--vp-c-brand-soft), transparent 65%);
}
.hero-inner {
  position: relative;
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 56px;
  align-items: center;
}
.prompt,
.cmd {
  font-family: var(--mono);
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin: 0 0 18px;
}
.p-user {
  color: var(--vp-c-brand-1);
}
.p-path {
  color: var(--x-blue);
}
.p-dim {
  color: var(--vp-c-text-3);
  margin-right: 6px;
}
.p-path + .p-dim {
  margin-left: 2px;
}
.name {
  font-size: clamp(40px, 6vw, 64px);
  line-height: 1.05;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0 0 20px;
}
.lead {
  font-size: clamp(18px, 2.2vw, 22px);
  line-height: 1.5;
  color: var(--vp-c-text-1);
  margin: 0 0 12px;
  max-width: 34em;
}
.hl {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.sub {
  font-size: 16px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
  margin: 0 0 28px;
  max-width: 38em;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 18px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
}
.btn-primary {
  background: var(--vp-c-brand-1);
  color: var(--x-on-brand);
}
.btn-primary:hover {
  background: var(--vp-c-brand-2);
}
.btn-ghost {
  border: 1px solid var(--x-border);
  color: var(--vp-c-text-1);
  background: var(--x-panel);
}
.btn-ghost:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.socials {
  display: flex;
  gap: 6px;
}
.social {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  color: var(--vp-c-text-2);
  transition: color 0.2s, background-color 0.2s;
}
.social:hover {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

/* console card */
.console {
  border: 1px solid var(--x-border);
  border-radius: 12px;
  background: var(--x-panel);
  overflow: hidden;
}
.console {
  box-shadow: 0 24px 60px -24px var(--x-shadow);
  font-family: var(--mono);
}
.console-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--x-border);
  background: var(--x-panel-2);
  font-family: var(--mono);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--x-border);
}
.console-title {
  margin-left: 10px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.console-body {
  padding: 20px 22px 18px;
}
.console-id {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 2px solid var(--vp-c-brand-1);
  object-fit: cover;
}
.id-name {
  font-size: 15px;
  font-weight: 600;
}
.id-status {
  font-size: 12px;
  color: var(--vp-c-text-2);
  display: flex;
  align-items: center;
  gap: 6px;
}
.live {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft);
}
.console .cmd {
  font-size: 13px;
  margin-bottom: 12px;
}
.kv {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 18px;
  margin: 0;
  font-size: 13px;
}
.kv dt {
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 11.5px;
  line-height: 20px;
}
.kv dd {
  margin: 0;
  color: var(--vp-c-text-1);
  line-height: 20px;
}

/* ---------- sections ---------- */
.section {
  padding: 88px 0 0;
  scroll-margin-top: 64px;
}
.section-last {
  padding-bottom: 96px;
}
.sec-head {
  margin-bottom: 32px;
}
.sec-label {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--vp-c-brand-1);
  margin: 0 0 8px;
}
.sec-label::before {
  content: '// ';
  color: var(--vp-c-text-3);
}
.sec-head h2,
.contact h2 {
  font-size: clamp(26px, 3.2vw, 34px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  margin: 0;
}
.sec-desc {
  margin: 10px 0 0;
  color: var(--vp-c-text-2);
  font-size: 16px;
}
.inline-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
}
.inline-link:hover {
  text-decoration: underline;
}
.panel {
  border: 1px solid var(--x-border);
  border-radius: 12px;
  background: var(--x-panel);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.chips li {
  font-family: var(--mono);
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--x-border);
  background: var(--x-panel-2);
  color: var(--vp-c-text-1);
}
.chips-sm li {
  font-size: 12px;
  padding: 2px 8px;
  color: var(--vp-c-text-2);
}
.chips li.lbadge,
.lbadge {
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--layer-c);
  color: var(--layer-c);
  background: transparent;
}

/* 联动高亮：悬停技术栈层时对应卡片描边，点击证据后跳转并闪一下 */
.lit {
  border-color: var(--layer-c) !important;
}
.pulse {
  border-color: var(--layer-c) !important;
  animation: pulse 0.9s ease-out 2;
}
@keyframes pulse {
  from {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--layer-c) 55%, transparent);
  }
  to {
    box-shadow: 0 0 0 14px transparent;
  }
}

/* stack: 分层架构图 */
.stack-fig {
  margin: 0;
  display: grid;
}
.cap,
.base {
  position: relative;
  margin-right: 284px;
  padding: 8px 12px;
  border-radius: 10px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.04em;
  text-align: center;
  color: var(--vp-c-text-3);
}
.cap {
  border: 1px dashed var(--x-border-hover);
  margin-bottom: 20px;
}
.base {
  margin-top: 20px;
  border: 1px solid var(--x-border);
  background: repeating-linear-gradient(
      135deg,
      transparent 0 6px,
      color-mix(in srgb, var(--vp-c-text-3) 9%, transparent) 6px 7px
    ),
    var(--x-panel-2);
}
.tier {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 24px;
  align-items: center;
}
.tier + .tier {
  margin-top: 20px;
}
/* 层与层之间的「接口」竖线 */
.slab::before,
.base::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -21px;
  height: 20px;
  background:
    linear-gradient(var(--x-border-hover), var(--x-border-hover)) 25% 0 / 1px 100% no-repeat,
    linear-gradient(var(--x-border-hover), var(--x-border-hover)) 50% 0 / 1px 100% no-repeat,
    linear-gradient(var(--x-border-hover), var(--x-border-hover)) 75% 0 / 1px 100% no-repeat;
}
.slab {
  position: relative;
  padding: 16px 18px 18px;
  border: 1px solid color-mix(in srgb, var(--layer-c) 35%, var(--x-border));
  border-radius: 12px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--layer-c) 7%, var(--x-panel)), var(--x-panel) 70%);
  box-shadow: 0 5px 0 -1px color-mix(in srgb, var(--layer-c) 28%, transparent);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.tier.active .slab {
  border-color: var(--layer-c);
  box-shadow: 0 5px 0 -1px color-mix(in srgb, var(--layer-c) 55%, transparent);
}
.slab-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.layer-id {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--layer-c);
  border: 1px solid currentColor;
  border-radius: 5px;
  padding: 1px 6px;
}
.layer-name {
  font-weight: 600;
  font-size: 16px;
}
.groups {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 22px;
}
.group {
  display: grid;
  gap: 6px;
  align-content: start;
}
.g-label {
  font-family: var(--mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--vp-c-text-3);
}
.blocks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.blocks li {
  font-family: var(--mono);
  font-size: 12.5px;
  padding: 4px 9px;
  border-radius: 6px;
  border: 1px solid var(--x-border);
  background: var(--x-panel-2);
  color: var(--vp-c-text-1);
}
/* L3 拆成两个并排的独立层框，颜色同 L3 */
.slab-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.slab.active {
  border-color: var(--layer-c);
  box-shadow: 0 5px 0 -1px color-mix(in srgb, var(--layer-c) 55%, transparent);
}
.slab.exploring .blocks li {
  border-style: dashed;
  background: transparent;
  color: var(--vp-c-text-2);
}
.ev-lane {
  display: inline-block;
  min-width: 52px;
  margin-right: 6px;
  font-family: var(--mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vp-c-text-3);
}
.ev.dim {
  opacity: 0.4;
}
/* 右侧证据列：用一条虚线接到对应的层 */
.ev-list {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 4px 0 4px 14px;
  border-left: 1px solid color-mix(in srgb, var(--layer-c) 60%, transparent);
  display: grid;
  gap: 4px;
}
.ev-list::before {
  content: '';
  position: absolute;
  left: -25px;
  top: 50%;
  width: 24px;
  border-top: 1px dashed color-mix(in srgb, var(--layer-c) 60%, transparent);
}
.ev {
  display: inline-block;
  font-size: 13.5px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  padding: 2px 8px;
  margin-left: -8px;
  border-radius: 5px;
  transition: color 0.2s, background-color 0.2s;
}
.tier.active .ev {
  color: var(--vp-c-text-1);
}
.ev:hover,
.ev:focus-visible {
  color: var(--layer-c);
  background: color-mix(in srgb, var(--layer-c) 12%, transparent);
}

/* experience: git log。去掉外框，只保留一条时间线 */
.mono-desc {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--vp-c-text-3);
}
.commits {
  list-style: none;
  margin: 0;
  padding: 0;
}
.commit {
  display: grid;
  grid-template-columns: 28px 1fr;
}
.rail {
  position: relative;
}
.rail::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--x-border-hover);
}
.commit:first-child .rail::before {
  top: 14px;
}
.commit:last-child .rail::before {
  bottom: auto;
  height: 14px;
}
.node {
  position: absolute;
  left: 6px;
  top: 9px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--layer-c, var(--vp-c-text-3));
  box-shadow: 0 0 0 3px var(--vp-c-bg);
}
.root .node {
  background: var(--vp-c-bg);
  border: 2px solid var(--layer-c);
}
.upcoming .node {
  background: var(--vp-c-bg);
  border: 2px dashed var(--vp-c-brand-1);
}
.c-body {
  padding: 2px 10px 32px;
  border-radius: 8px;
  transition: background-color 0.3s;
}
.commit.lit .c-body,
.commit.pulse .c-body {
  background: color-mix(in srgb, var(--layer-c) 6%, transparent);
}
.commit.pulse {
  animation: none;
  box-shadow: none;
}
.commit.pulse .c-body {
  animation: tint 0.9s ease-out 2;
}
@keyframes tint {
  from {
    background: color-mix(in srgb, var(--layer-c) 18%, transparent);
  }
}
.c-head {
  margin: 0;
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--vp-c-text-3);
  line-height: 22px;
}
.c-hash,
.upcoming .c-word {
  color: var(--vp-c-brand-1);
}
.refs {
  color: var(--vp-c-text-3);
}
.ref-head {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.ref-tag {
  color: var(--layer-c);
}
.c-title {
  margin: 4px 0 2px;
  font-size: 18px;
  font-weight: 600;
}
.org {
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
a.org:hover {
  text-decoration: underline;
}
.c-date {
  margin: 0 0 12px;
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--vp-c-text-3);
}
.bullets {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: grid;
  gap: 6px;
  max-width: 860px;
}
.bullets li {
  position: relative;
  padding-left: 18px;
  font-size: 14.5px;
  line-height: 1.6;
}
.bullets li::before {
  content: '›';
  position: absolute;
  left: 2px;
  font-family: var(--mono);
  color: var(--vp-c-text-3);
}
.diffstat {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  font-family: var(--mono);
  font-size: 12.5px;
}
.add {
  color: var(--vp-c-brand-1);
  font-family: var(--mono);
}
.course-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 24px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  max-width: 820px;
}
.course-list .add {
  display: inline-block;
  min-width: 64px;
  font-size: 12.5px;
}

/* projects */
.featured {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}
.proj {
  display: flex;
  flex-direction: column;
  transition: border-color 0.2s;
  scroll-margin-top: 80px;
}
.proj:hover {
  border-color: var(--x-border-hover);
}
.proj-featured {
  padding: 24px;
}
.proj h3 {
  font-size: 19px;
  font-weight: 600;
  margin: 14px 0 8px;
}
.proj-summary {
  font-size: 14.5px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
  margin: 0;
}
.readouts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 22px 0 20px;
  border: 1px solid var(--x-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--x-border);
}
.readout {
  background: var(--x-panel-2);
  padding: 12px 14px;
}
.readout dt {
  font-family: var(--mono);
  font-size: 20px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  white-space: nowrap;
}
.readout dd {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--vp-c-text-2);
}
.proj-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}
.plink {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--x-border);
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: border-color 0.2s, color 0.2s;
}
.plink:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.others {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.proj-small {
  overflow: hidden;
}
.thumb {
  display: block;
  aspect-ratio: 16 / 9;
  border-bottom: 1px solid var(--x-border);
  background: var(--x-panel-2);
  overflow: hidden;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s;
}
.proj-small:hover .thumb img {
  transform: scale(1.03);
}
.proj-body {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}
.proj-body h3 {
  margin: 0;
  font-size: 17px;
}

/* writing */
.posts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.post {
  position: relative;
  display: block;
  padding: 22px 56px 22px 24px;
  border: 1px solid var(--x-border);
  border-radius: 12px;
  background: var(--x-panel);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.2s;
  scroll-margin-top: 80px;
}
.post:hover {
  border-color: var(--vp-c-brand-1);
}
.post-lead {
  grid-column: 1 / -1;
  background:
    linear-gradient(135deg, var(--vp-c-brand-soft), transparent 55%),
    var(--x-panel);
}
.post-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tag {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--vp-c-brand-1);
}
.status {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--vp-c-text-2);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.post h3 {
  font-size: 19px;
  font-weight: 600;
  margin: 10px 0 6px;
}
.post-lead h3 {
  font-size: 24px;
}
.post p {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
  max-width: 60em;
}
.post-arrow {
  position: absolute;
  right: 22px;
  top: 24px;
  color: var(--vp-c-text-3);
  transition: color 0.2s, transform 0.2s;
}
.post:hover .post-arrow {
  color: var(--vp-c-brand-1);
  transform: translateX(3px);
}

/* contact */
.contact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 32px;
}
.contact .cmd {
  margin-bottom: 8px;
}
.contact-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* ---------- responsive ---------- */
@media (max-width: 960px) {
  .hero-inner {
    grid-template-columns: 1fr;
    gap: 40px;
  }
  .tier {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .cap,
  .base {
    margin-right: 0;
  }
  .ev-list::before {
    display: none;
  }
  .others {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 768px) {
  .wrap {
    padding: 0 16px;
  }
  .hero {
    padding: 48px 0 64px;
  }
  .section {
    padding-top: 64px;
  }
  .featured,
  .posts,
  .others,
  .course-list,
  .slab-row {
    grid-template-columns: 1fr;
  }
  .readouts {
    grid-template-columns: 1fr;
  }
  .c-body {
    padding: 2px 0 26px 6px;
  }
  .contact {
    flex-direction: column;
    align-items: flex-start;
    padding: 24px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pulse,
  .commit.pulse .c-body {
    animation: none !important;
  }
  .btn,
  .proj,
  .thumb img,
  .post-arrow,
  .slab {
    transition: none;
  }
}
</style>
