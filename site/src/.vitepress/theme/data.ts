// 站点内容的单一数据源：首页和博客索引都从这里读取。

export interface Link {
  label: string
  href: string
  kind: 'github' | 'doc' | 'video'
}

export type LayerId = 'L1' | 'L2' | 'L3'
/** L3 内部再分两条并排的方向 */
export type LaneId = 'agent' | 'serving'

export interface Experience {
  role: string
  layer?: LayerId
  lane?: LaneId
  org: string
  orgUrl: string
  location: string
  period: string
  /** 已拿到 offer、尚未入职 */
  upcoming?: boolean
  stack: string[]
  bullets: string[]
}

export interface Project {
  name: string
  layer?: LayerId
  stack: string[]
  summary: string
  readouts?: { value: string; label: string }[]
  image?: string
  links: Link[]
  featured?: boolean
}

export interface Post {
  title: string
  layer?: LayerId
  lane?: LaneId
  href: string
  tag: string
  summary: string
  status?: string
}

export const profile = {
  name: 'Chenguang Liu',
  handle: 'chenguang',
  avatar: '/assets/125529485.png',
  resume: '/assets/resume.pdf',
  socials: [
    { label: 'GitHub', href: 'https://github.com/CleverAutoman', icon: 'github' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/chenguang-liu-a69a94269/', icon: 'linkedin' },
    { label: 'X', href: 'https://x.com/CleverAutoman', icon: 'x' },
    { label: 'Instagram', href: 'https://www.instagram.com/cleverautoman111/', icon: 'instagram' }
  ]
}

// 从上到下：越靠上越接近模型，越靠下越接近硬件。exploring 是正在学习、博客里在写的方向
export interface StackGroup {
  label: string
  items: string[]
}
export interface StackLane {
  id: LaneId
  name: string
  /** shipped：做过上线的；exploring：正在学、博客里在写的 */
  state: 'shipped' | 'exploring'
  groups: StackGroup[]
}
export const stackLayers: {
  id: LayerId
  name: string
  groups?: StackGroup[]
  /** 有 lanes 时，这一层横向分成并排的几块 */
  lanes?: StackLane[]
}[] = [
  {
    id: 'L3',
    name: 'AI Infrastructure',
    lanes: [
      {
        id: 'agent',
        name: 'Agent Infra',
        state: 'shipped',
        groups: [
          { label: 'orchestration', items: ['Multi-Agent Orchestration', 'DAG Execution', 'LangGraph'] },
          { label: 'tooling & eval', items: ['Tool Calls', 'MCP', 'RAG', 'Automated LLM Evaluation'] }
        ]
      },
      {
        id: 'serving',
        name: 'Serving Infra',
        state: 'exploring',
        groups: [
          { label: 'engines', items: ['vLLM', 'SGLang'] },
          { label: 'optimization', items: ['Quantization', 'Prefix Caching', 'Speculative Decoding'] }
        ]
      }
    ]
  },
  {
    id: 'L2',
    name: 'Backend & Distributed Systems',
    groups: [
      { label: 'languages', items: ['Go', 'Python', 'TypeScript', 'Java', 'SQL'] },
      { label: 'systems', items: ['gRPC', 'Kafka', 'Workflow Orchestration', 'Concurrency'] },
      { label: 'data & infra', items: ['PostgreSQL', 'Redis', 'AWS', 'Docker', 'CI/CD'] }
    ]
  },
  {
    id: 'L1',
    name: 'Systems Foundations',
    groups: [
      { label: 'built from scratch', items: ['OS Kernel', 'Database Engine', 'RISC-V CPU', 'Unix Shell'] },
      { label: 'languages', items: ['C/C++'] }
    ]
  }
]

export const courses = [
  { code: 'CS 61A', title: 'Structure of Computer Programs' },
  { code: 'CS 61B', title: 'Data Structures and Algorithms' },
  { code: 'CS 61C', title: 'Computer Architecture' },
  { code: 'CS 162', title: 'Operating Systems' },
  { code: 'CS 186', title: 'Database Systems' },
  { code: 'CS 168', title: 'Introduction to the Internet' }
]

export const experiences: Experience[] = [
  {
    role: 'Software Engineer',
    org: 'TikTok',
    orgUrl: 'https://www.tiktok.com/about',
    location: 'San Jose, CA',
    period: 'Starting Feb 2027 (est.)',
    upcoming: true,
    stack: [],
    bullets: []
  },
  {
    role: 'Software Engineer Intern',
    org: 'TikTok',
    layer: 'L3',
    lane: 'agent',
    orgUrl: 'https://www.tiktok.com/about',
    location: 'San Jose, CA',
    period: 'May 2026 – Aug 2026',
    stack: ['Go', 'Multi-Agent Orchestration', 'DAG Execution', 'LLM Evaluation', 'Concurrency'],
    bullets: [
      'Built a multi-agent Evaluation Framework in Go from 0 to 1, converting natural-language SOPs into validated DAGs and orchestrating Draft, Prompt, and Evaluation agents across Lark and Spreadsheet workflows.',
      'Scaled four evaluation scenarios to 1,681 runs and 3,463 assessment items with at least 99.5% completion; achieved 99.43% Pixel Event accuracy, 2.16 percentage points above the human-labeling baseline.',
      'Designed bounded concurrency, leased worker pools, session isolation, and automatic rebuilds, cutting execution time 51.9% (67.56 to 32.53 minutes per 100 rows) while maintaining 89% accuracy.'
    ]
  },
  {
    role: 'Research Assistant',
    org: 'UC Berkeley',
    layer: 'L2',
    orgUrl: 'https://ced.berkeley.edu/',
    location: 'Berkeley, CA',
    period: 'Aug 2025 – Dec 2025',
    stack: ['Python', 'PostgreSQL', 'WebSocket', 'TypeScript', 'RBAC'],
    bullets: [
      'Built a Python/PostgreSQL backend with WebSockets for real-time TypeScript clients, supporting 500+ concurrent users with RBAC and tenant isolation.',
      'Implemented optimistic concurrency control in PostgreSQL to reject stale writes and maintain consistent geometry state.'
    ]
  },
  {
    role: 'Software Engineer',
    org: 'Meituan',
    layer: 'L2',
    orgUrl: 'https://www.linkedin.com/company/meituan/',
    location: 'Beijing, China',
    period: 'Oct 2024 – May 2025',
    stack: ['Redis', 'Kafka', 'High-Concurrency APIs'],
    bullets: [
      'Optimized high-concurrency backend APIs through Redis caching and data-access refactoring, reducing latency 20%.',
      'Built a Kafka-backed delayed-task system with cancellation, rescheduling, version validation, and idempotent execution under at-least-once delivery.'
    ]
  }
]

export const projects: Project[] = [
  {
    name: 'Operating System Kernel',
    layer: 'L1',
    stack: ['C', 'Concurrency', 'File Systems'],
    summary:
      'Extended the Pintos OS skeleton with processes & syscalls, priority scheduling with donation, user threads, and an FFS-style file system with a Clock buffer cache.',
    readouts: [
      { value: '3.76×', label: 'file system speedup vs FAT' },
      { value: '1,488', label: 'user threads in one stress run' },
      { value: '~5×', label: 'throughput with buffer cache' }
    ],
    links: [
      { label: 'GitHub', href: 'https://github.com/CleverAutoman/os-systems-project', kind: 'github' },
      { label: 'Design doc', href: '/blog/os-project', kind: 'doc' }
    ],
    featured: true
  },
  {
    name: 'Relational Database Engine',
    layer: 'L1',
    stack: ['Java', 'B+Tree', 'ARIES'],
    summary:
      'Clustered B+Tree indexing, a cost-based query optimizer with multiple join algorithms, multi-granularity 2PL locking, and ARIES-style crash recovery.',
    readouts: [
      { value: '603 → 8', label: 'I/Os after picking sort-merge join' },
      { value: '5', label: 'lock modes in multi-granularity 2PL' },
      { value: '3', label: 'ARIES phases: analysis, redo, undo' }
    ],
    image: '/assets/db_architecture.png',
    links: [
      { label: 'GitHub', href: 'https://github.com/CleverAutoman/relational-db-engine', kind: 'github' },
      { label: 'Design doc', href: '/blog/db-engine', kind: 'doc' }
    ],
    featured: true
  },
  {
    name: '2-Stage Pipelined RISC-V CPU',
    layer: 'L1',
    stack: ['Logisim', 'RISC-V', 'Microarchitecture'],
    summary:
      'Fetch / Execute pipelined CPU supporting a subset of the RISC-V ISA: full datapath, control logic, and hazard handling, verified cycle-accurately.',
    links: []
  },
  {
    name: 'Unix-like Shell',
    layer: 'L1',
    stack: ['Processes', 'Signals', 'File descriptors'],
    summary:
      'Mini shell with built-ins, external programs, a tokenizer-driven parser, I/O redirection, pipelines, and job control via Ctrl-C / Ctrl-Z.',
    image: '/assets/my-shell.png',
    links: [{ label: 'Demo', href: 'https://youtu.be/B6Osq0LgZWQ', kind: 'video' }]
  },
  {
    name: 'My World Game',
    stack: ['Java', 'OOP', 'A*'],
    summary:
      'Grid-based world where the player collects items and avoids enemies, built on core data structures, A* search, and OOP design.',
    image: '/assets/my-world.png',
    links: [{ label: 'Demo', href: 'https://youtu.be/QYSEIfgd5dA', kind: 'video' }]
  }
]

export const posts: Post[] = [
  {
    title: 'AI Infra 实战笔记',
    layer: 'L3',
    lane: 'serving',
    href: '/blog/ai-infra/',
    tag: 'Series · 中文',
    summary:
      'Running LLM infrastructure on a budget, with SGLang as the main line: serving, internals, tuning, fine-tuning, and deployment, with vLLM as the comparison. Every post ships reproducible benchmarks and its cloud cost.',
    status: 'in progress'
  },
  {
    title: 'Operating System Project',
    href: '/blog/os-project',
    tag: 'Design doc',
    summary:
      'Processes and syscalls, priority donation, user threads, and an FFS-style file system with a Second-Chance Clock buffer cache, with benchmarks.'
  },
  {
    title: 'Relational Database Engine',
    href: '/blog/db-engine',
    tag: 'Design doc',
    summary:
      'B+Tree indexing, cost-based join optimization, multi-granularity locking, and ARIES-style recovery.'
  }
]
