/**
 * giscus 评论配置（基于 GitHub Discussions）。
 *
 * 启用步骤：
 * 1. 仓库 Settings → Features → 勾选 Discussions
 * 2. 安装 giscus app：https://github.com/apps/giscus ，授权给 my-website 仓库
 * 3. 打开 https://giscus.app ，填仓库名，选一个分类（建议 Announcements），
 *    把页面给出的 data-category 和 data-category-id 填到下面
 *
 * category / categoryId 留空时评论区不显示。
 */
export const giscusConfig = {
  repo: 'CleverAutoman/my-website' as `${string}/${string}`,
  repoId: 'R_kgDOQ2bdDw',
  category: '',
  categoryId: ''
}
