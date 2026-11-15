// 「从面板模板添加」的常用目录（PRD 6.4 路径页）。按各面板的默认安装位置，2026-10-28 对照官方文档与社区核实：
// 1Panel 默认装在 /opt/1panel，OpenResty 等应用在 apps/<应用>/<名称> 下；宝塔见 bt.cn「宝塔 Linux 面板命令大全」
// 用途文字在 copy.ts 的 pathTemplates 里，按 key 取
export type PanelTemplateId = "1panel" | "bt"

export interface PathTemplate {
  /** 写进资产的 AssetPath.key，同一资产内唯一 */
  key: string
  path: string
}

export const PANEL_TEMPLATES: { id: PanelTemplateId; paths: PathTemplate[] }[] = [
  {
    id: "1panel",
    paths: [
      { key: "1panel-openresty-conf", path: "/opt/1panel/apps/openresty/openresty/conf/conf.d" },
      { key: "1panel-sites", path: "/opt/1panel/apps/openresty/openresty/www/sites" },
      { key: "1panel-openresty-log", path: "/opt/1panel/apps/openresty/openresty/log" },
      { key: "1panel-apps", path: "/opt/1panel/apps" },
      { key: "1panel-compose", path: "/opt/1panel/docker/compose" },
      { key: "1panel-backup", path: "/opt/1panel/backup" },
    ],
  },
  {
    id: "bt",
    paths: [
      { key: "bt-nginx-vhost", path: "/www/server/panel/vhost/nginx" },
      { key: "bt-wwwroot", path: "/www/wwwroot" },
      { key: "bt-wwwlogs", path: "/www/wwwlogs" },
      { key: "bt-nginx-conf", path: "/www/server/nginx/conf" },
      { key: "bt-mysql-data", path: "/www/server/data" },
      { key: "bt-backup-site", path: "/www/backup/site" },
      { key: "bt-backup-db", path: "/www/backup/database" },
    ],
  },
]
