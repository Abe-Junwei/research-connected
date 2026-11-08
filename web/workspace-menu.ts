import { createChromeIcon, positionPopover, registerPopover } from "../src/graph-chrome";
import { tr } from "../src/i18n";
import { downloadText, exportFilename } from "../src/export-file";
import { MAX_BACKUP_BYTES, parseWorkspaceBackup, type WorkspaceBackup } from "./workspace-backup";

export function mountWorkspaceMenu(host: HTMLElement, options: {
 capture(): WorkspaceBackup;
 getInfo?(): { title: string; nodes: number; edges: number };
 canRestore(): boolean;
 revision(): string | null;
 restore(backup: WorkspaceBackup, revision: string | null): Promise<void>;
 notify(message: string): void;
}): { confirmClear(): Promise<boolean>; confirmChoice(message: string): Promise<boolean> } {
 const group = host.querySelector(".cpo-project-group");
 if (!group) throw new Error("Missing workspace controls");
 const menu = document.createElement("details"); menu.className = "cpo-menu cpo-workspace-menu";
 const summary = document.createElement("summary"); summary.setAttribute("aria-label", tr("备份与恢复", "Backup and restore")); summary.title = tr("备份与恢复", "Backup and restore"); summary.append(createChromeIcon("project")); menu.append(summary);
 const items = document.createElement("div"); items.className = "cpo-menu-items"; menu.append(items);
 registerPopover(menu);
 const header = document.createElement("div"); header.className = "cpo-export-header";
 const heading = document.createElement("strong"); heading.textContent = tr("备份与恢复", "Backup and restore"); header.append(heading); items.append(header);
 const content = document.createElement("section"); content.className = "cpo-workspace-backup-content"; items.append(content);
 const title = document.createElement("h3"); title.textContent = tr("当前工作区备份", "Current workspace backup");
 const badge = document.createElement("span"); badge.className = "cpo-backup-type"; badge.textContent = tr("JSON · 用于恢复图谱", "JSON · Restore the graph");
 const description = document.createElement("p"); description.className = "cpo-export-description"; description.textContent = tr("当前这一张图谱 + 全部保留的整理记录", "This graph + all retained literature records");
 const identity = document.createElement("div"); identity.className = "cpo-backup-identity";
 const graphTitle = document.createElement("strong"), graphSize = document.createElement("p");
 const includes = document.createElement("ul");
 for (const text of [tr("当前图谱：文献节点与关系、收藏/排除、深挖、筛选与视角", "Current graph: papers, relations, favorites, exclusions, deep dives, filters and camera"), tr("跨图保留的记录：全部阅读状态和版本记录", "Retained across graphs: all reading and version records")]) { const item = document.createElement("li"); item.textContent = text; includes.append(item); }
 identity.append(graphTitle, graphSize, includes); content.append(title, badge, description, identity);

 const button = (parent: HTMLElement, label: string, action: () => void): HTMLButtonElement => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = action; parent.append(b); return b; };

 const close = button(header, tr("关闭", "Close"), () => { menu.open = false; summary.focus(); }); close.className = "cpo-tool cpo-export-close"; close.setAttribute("aria-label", tr("关闭备份菜单", "Close backup menu"));
 const download = (feedback?: HTMLElement): void => {
  try {
   const backup = options.capture();
   const title = backup.data.project?.snapshot?.nodes.find(paper => paper.isSeed)?.title ?? "workspace";
   downloadText(exportFilename(title, "wenxian.json"), JSON.stringify(backup), "application/json");
   const message = tr("已发起当前工作区备份下载，请确认文件已保存。此操作不会修复浏览器自动保存失败。", "Workspace backup download requested. Check that the file was saved; this does not repair browser autosave failures.");
   if (feedback) feedback.textContent = message; else options.notify(message);
  } catch (error) { const message = String(error); if (feedback) feedback.textContent = message; else options.notify(message); }
 };
 const backupButton = button(content, tr("下载工作区备份 .json", "Download workspace backup .json"), () => { menu.open = false; download(); });
 backupButton.className = "cpo-backup-download";
 const positionHelp = document.createElement("p"); positionHelp.className = "cpo-export-description cpo-backup-position-help"; positionHelp.textContent = tr("恢复时节点会重新排布，布局与视角会保留", "Node positions are recomputed; layout and camera are retained"); content.append(positionHelp);
 const actions = document.createElement("div"); actions.className = "cpo-workspace-backup-actions"; items.append(actions);
 const file = document.createElement("input"); file.type = "file"; file.accept = ".json,application/json"; file.hidden = true; host.append(file);
 const restoreButton = button(actions, tr("从备份文件恢复…", "Restore from backup file…"), () => {
  if (!options.canRestore()) { options.notify(tr("请先完成或取消任务，并取得工作区编辑权。", "Finish or cancel tasks and acquire workspace editing first.")); return; }
  menu.open = false; file.value = ""; file.click();
 });
 menu.addEventListener("toggle", () => {
  if (!menu.open) return;
  restoreButton.disabled = !options.canRestore();
  const info = options.getInfo?.(); graphTitle.textContent = info?.title || tr("当前无图谱", "No current graph");
  graphSize.textContent = info?.nodes ? tr(`${info.nodes} 个节点 · ${info.edges} 条关系`, `${info.nodes} nodes · ${info.edges} edges`) : tr("仍可备份已保留的阅读和版本记录", "Retained reading and version records can still be backed up");
  positionPopover(items);
 });
 const clear = group.querySelector<HTMLButtonElement>(".cpo-workspace-clear"); if (clear) { clear.textContent = tr("清空工作区…", "Clear workspace…"); clear.classList.add("cpo-workspace-danger"); actions.append(clear); }
 group.prepend(menu);
 function dialog(title: string, description: string, acceptLabel: string, onAccept?: () => Promise<void>, workspaceAction = true): Promise<boolean> {
  return new Promise(resolve => {
   const modal = document.createElement("dialog"); modal.className = "cpo-surface cpo-workspace-dialog";
   const heading = document.createElement("h2"); heading.textContent = title; heading.id = "cpo-workspace-dialog-title"; modal.setAttribute("aria-labelledby", heading.id); modal.append(heading);
   const body = document.createElement("p"); body.textContent = description; body.className = "cpo-workspace-description"; modal.append(body);
   const feedback = document.createElement("p"); feedback.setAttribute("role", "status"); modal.append(feedback);
   const actions = document.createElement("div"); actions.className = "cpo-workspace-dialog-actions"; modal.append(actions);
   const backup = button(actions, tr("下载当前备份", "Download current backup"), () => download(feedback)); backup.className = "cpo-ghost cpo-workspace-dialog-backup"; backup.hidden = !workspaceAction;
   const cancel = button(actions, tr("取消", "Cancel"), () => modal.close());
   cancel.className = "cpo-ghost";
   const accept = button(actions, acceptLabel, () => {
    if (workspaceAction && !options.canRestore()) { feedback.textContent = tr("任务或编辑权已变化，请取消后重试。", "Task or editing access changed. Cancel and try again."); return; }
    if (!onAccept) { modal.returnValue = "confirmed"; modal.close(); return; }
    accept.disabled = true; cancel.disabled = true;
    void onAccept().then(() => { modal.returnValue = "confirmed"; modal.close(); }).catch(error => { feedback.textContent = String(error); accept.disabled = false; cancel.disabled = false; });
   });
   accept.className = workspaceAction ? "cpo-primary cpo-workspace-dialog-danger" : "cpo-primary";
   modal.addEventListener("cancel", event => { if (accept.disabled) event.preventDefault(); });
   modal.addEventListener("close", () => { const accepted = modal.returnValue === "confirmed"; modal.remove(); resolve(accepted); }, { once: true });
   document.body.append(modal); modal.showModal(); cancel.focus();
  });
 }
 file.onchange = () => {
  const chosen = file.files?.[0]; if (!chosen) return;
  const revision = options.revision();
  void (async () => {
   if (!options.canRestore()) throw new Error(tr("工作区忙碌或只读，无法恢复。", "Workspace is busy or read-only."));
   if (chosen.size > MAX_BACKUP_BYTES) throw new Error("备份超过 20 MB / Backup exceeds 20 MB");
   const backup = parseWorkspaceBackup(await chosen.text());
   const data = backup.data, project = data.project;
   const seed = project?.snapshot?.nodes.find(paper => paper.isSeed);
   const states = Object.values(project?.versionStates ?? project?.paperStates ?? {});
   const description = [tr(`备份时间：${backup.createdAt}`, `Backup date: ${backup.createdAt}`), seed ? seed.title : tr("无图谱", "No graph"), tr(`${project?.snapshot?.nodes.length ?? 0} 个节点 · ${project?.snapshot?.edges.length ?? 0} 条关系`, `${project?.snapshot?.nodes.length ?? 0} nodes · ${project?.snapshot?.edges.length ?? 0} edges`), tr(`收藏记录 ${states.filter(state => state.staged).length} 条；排除记录 ${states.filter(state => state.excluded).length} 条；深挖 ${project?.deepDives?.length ?? 0} 批`, `${states.filter(state => state.staged).length} saved records; ${states.filter(state => state.excluded).length} excluded records; ${project?.deepDives?.length ?? 0} deep dives`), tr(`阅读记录 ${Object.keys(data.readingWorkflow?.records ?? {}).length} 条；版本记录 ${(data.workIdentityDecisions?.length ?? 0) + (data.sourceVersionRelations?.length ?? 0)} 条`, `${Object.keys(data.readingWorkflow?.records ?? {}).length} reading records; ${(data.workIdentityDecisions?.length ?? 0) + (data.sourceVersionRelations?.length ?? 0)} version records`), tr("确认后完整替换当前图谱及全部文献整理记录，不合并；此操作无法撤销。保留当前浏览器偏好和额度。节点会重新排布，恢复布局、筛选与视角。恢复不查询文献来源或消耗额度。", "Replaces the graph and all literature records without merging. Cannot be undone. Browser preferences and allowance remain. Node positions are recomputed; layout, filters and camera are restored. No source queries or allowance charges.")].join("\n");
   await dialog(tr("恢复工作区备份", "Restore workspace backup"), description, tr("确认替换并恢复", "Replace and restore"), () => options.restore(backup, revision));
  })().catch(error => options.notify(String(error)));
 };
 return { confirmChoice: message => dialog(tr("采用更新后的图谱", "Use the updated graph"), message, tr("采用新图", "Use new graph"), undefined, false), confirmClear: () => dialog(tr("清空工作区", "Clear workspace"), tr("将清除当前图谱、收藏、排除、深挖、全部阅读状态和版本记录，无法撤销。可先下载备份；下载不会自动执行清空。", "Deletes the graph, favorites, exclusions, deep dives, all reading and version records. Cannot be undone. You can download a backup first; downloading does not clear the workspace."), tr("确认清空", "Confirm clear")) };
}
