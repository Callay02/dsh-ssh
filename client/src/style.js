export const css = `
.dsh-ssh-launcher {
  position: fixed;
  right: 20px;
  bottom: 22px;
  z-index: 31;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px 0 10px;
  border-radius: 17px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-soft);
  font-family: var(--dsw-font-family);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  cursor: pointer;
  transition: background .15s ease, transform .15s ease;
}
.dsh-ssh-launcher:hover { background: var(--dsw-alias-interactive-bg-hover); transform: translateY(-1px); }
.dsh-ssh-launcher svg { color: var(--dsw-alias-brand-primary); }

.dsh-ssh-root {
  position: fixed;
  inset: var(--dsh-frame-chrome-top, 0px) 0 0 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  font-family: var(--dsw-font-family);
  color: var(--dsw-alias-label-primary);
}
.dsh-ssh-mask {
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur, blur(8px));
}
.dsh-ssh-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1180px, calc(100vw - 48px));
  height: min(820px, calc(100vh - 56px));
  border-radius: var(--dsw-radius-panel, 16px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  overflow: hidden;
}
.dsh-ssh-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  flex: none;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsh-ssh-brand { display: flex; align-items: baseline; gap: 8px; }
.dsh-ssh-brand-icon { display: inline-flex; align-self: center; color: var(--dsw-alias-brand-primary); }
.dsh-ssh-brand-title { font-size: 15px; font-weight: 600; letter-spacing: .02em; }
.dsh-ssh-brand-sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-ssh-panel-head-actions { display: flex; align-items: center; gap: 4px; }

.dsh-ssh-panel-body { display: flex; flex: 1; min-height: 0; }
.dsh-ssh-side {
  width: 256px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-ssh-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  flex: none;
  padding: 0 8px 0 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  letter-spacing: .03em;
}
.dsh-ssh-conn-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 8px; }
.dsh-ssh-conn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px 8px 8px;
  border-radius: var(--dsw-radius-md, 8px);
  cursor: pointer;
  outline: none;
}
.dsh-ssh-conn:hover, .dsh-ssh-conn:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ssh-conn.is-active { background: var(--dsw-alias-interactive-bg-active); }
.dsh-ssh-conn-text { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px; }
.dsh-ssh-conn-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-ssh-conn-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-ssh-conn-actions { display: flex; gap: 1px; opacity: .55; }
.dsh-ssh-conn:hover .dsh-ssh-conn-actions, .dsh-ssh-conn.is-active .dsh-ssh-conn-actions { opacity: 1; }
.dsh-ssh-side-empty { padding: 32px 12px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.dsh-ssh-side-foot {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 10px 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1.4;
}

.dsh-ssh-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.dsh-ssh-main-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px 8px 16px; }
.dsh-ssh-main-title { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dsh-ssh-main-name { display: flex; align-items: center; gap: 7px; font-size: 14px; min-width: 0; }
.dsh-ssh-main-name strong { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-ssh-main-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-ssh-inline-error { color: var(--dsw-alias-state-error-primary); }
.dsh-ssh-main-actions { display: flex; align-items: center; gap: 6px; flex: none; }

.dsh-ssh-tabs { display: flex; align-items: center; gap: 2px; padding: 0 10px; height: 38px; flex: none; border-bottom: 1px solid var(--dsw-alias-border-l2); overflow-x: auto; }.dsh-ssh-tabs::-webkit-scrollbar { height: 0; }
.dsh-ssh-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px 0 9px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex: none;
}
.dsh-ssh-tab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-ssh-tab.is-active { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.dsh-ssh-tab svg { opacity: .8; }
.dsh-ssh-tab-close { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; margin-right: -4px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; opacity: .55; cursor: pointer; }
.dsh-ssh-tab-close:hover { opacity: 1; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ssh-tab-add { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; flex: none; }
.dsh-ssh-tab-add:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-ssh-tab-spacer { flex: 1; }

.dsh-ssh-stage { position: relative; flex: 1; min-height: 0; display: flex; }
.dsh-ssh-term-pane { flex: 1; min-width: 0; min-height: 0; display: flex; }
.dsh-ssh-files-pane { flex: 1; min-width: 0; min-height: 0; display: flex; }

.dsh-ssh-term { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }

.dsh-ssh-term-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 28px;
  flex: none;
  margin: 6px 6px 0;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.dsh-ssh-term-stats::-webkit-scrollbar { display: none; }
.dsh-ssh-term-conn { display: inline-flex; align-items: center; gap: 5px; font-weight: 500; flex: none; }
.dsh-ssh-term-conn::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .9; }
.dsh-ssh-term-conn.is-connected { color: var(--dsw-alias-state-success-primary); }
.dsh-ssh-term-conn.is-connecting { color: var(--dsw-alias-state-warn-primary); }
.dsh-ssh-term-conn.is-error { color: var(--dsw-alias-state-error-primary); }
.dsh-ssh-term-conn.is-disconnected { color: var(--dsw-alias-label-tertiary); }
.dsh-ssh-metric { display: inline-flex; align-items: center; gap: 3px; flex: none; font-variant-numeric: tabular-nums; }
.dsh-ssh-metric-arrow { color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.dsh-ssh-term-stats-spacer { flex: 1; min-width: 6px; }
.dsh-ssh-term-platform { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
.dsh-ssh-term-stats.is-offline { color: var(--dsw-alias-label-tertiary); }
.dsh-ssh-term-state.is-offline { color: var(--dsw-alias-label-tertiary); }

.dsh-ssh-term-surface {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 8px 10px 0;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-ssh-term-host { position: absolute; inset: 0; padding: 6px 8px; }
.dsh-ssh-term-host .xterm { height: 100%; }
.dsh-ssh-term-host .xterm-viewport { background: transparent !important; }
.dsh-ssh-term-host .xterm-screen { height: 100%; }
.dsh-ssh-term-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  flex: none;
  padding: 0 12px 0 14px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-ssh-term-state { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-state-success-primary); }
.dsh-ssh-term-state::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dsh-ssh-term-state.is-ended { color: var(--dsw-alias-label-tertiary); }
.dsh-ssh-term-spacer { flex: 1; }
.dsh-ssh-term-error { color: var(--dsw-alias-state-error-primary); max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-ssh-term-ended { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, transparent); }
.dsh-ssh-term-ended-card { display: flex; flex-direction: column; gap: 8px; align-items: center; text-align: center; padding: 18px 22px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); box-shadow: var(--dsw-elevation-soft); }
.dsh-ssh-term-ended-title { font-size: 13px; font-weight: 600; }
.dsh-ssh-term-ended-desc { font-size: 12px; color: var(--dsw-alias-label-tertiary); max-width: 280px; }

.dsh-ssh-files { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.dsh-ssh-files-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 10px; flex: none; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-ssh-path-form { flex: 1; min-width: 0; }
.dsh-ssh-path-form .dsh-ssh-input { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.dsh-ssh-toolbar-sep { width: 1px; height: 18px; background: var(--dsw-alias-border-l2); margin: 0 2px; }
.dsh-ssh-files-body { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.dsh-ssh-files-body.is-drag { outline: 2px dashed var(--dsw-alias-brand-primary); outline-offset: -4px; }
.dsh-ssh-files-head, .dsh-ssh-file-row { display: grid; grid-template-columns: minmax(0, 1fr) 92px 158px 96px; align-items: center; gap: 8px; padding: 0 10px; }
.dsh-ssh-files-head { height: 30px; flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-ssh-files-head span:last-child { text-align: right; }
.dsh-ssh-files-list { flex: 1; min-height: 0; overflow-y: auto; }
.dsh-ssh-file-row { height: 34px; font-size: 12px; border-radius: 6px; cursor: default; }
.dsh-ssh-file-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ssh-file-name { display: flex; align-items: center; gap: 7px; min-width: 0; color: var(--dsw-alias-label-primary); }
.dsh-ssh-file-name svg { flex: none; color: var(--dsw-alias-label-tertiary); }
.dsh-ssh-file-row.is-dir .dsh-ssh-file-name svg { color: var(--dsw-alias-brand-primary); }
.dsh-ssh-file-link { border: 0; background: transparent; padding: 0; font: inherit; color: inherit; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.dsh-ssh-file-row.is-dir .dsh-ssh-file-link { cursor: pointer; }
.dsh-ssh-file-row.is-dir .dsh-ssh-file-link:hover { color: var(--dsw-alias-brand-primary); }
.dsh-ssh-file-size, .dsh-ssh-file-date { color: var(--dsw-alias-label-tertiary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-ssh-file-actions { display: flex; justify-content: flex-end; gap: 2px; opacity: 0; }
.dsh-ssh-file-row:hover .dsh-ssh-file-actions { opacity: 1; }
.dsh-ssh-files-loading { display: flex; align-items: center; gap: 8px; padding: 18px 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-ssh-drop-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 70%, transparent); color: var(--dsw-alias-brand-primary); font-size: 13px; font-weight: 600; pointer-events: none; }

.dsh-ssh-transfer {
  flex: none;
  margin: 0 6px 4px;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-ssh-transfer-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dsh-ssh-transfer-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-ssh-transfer-meta { flex: none; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dsh-ssh-transfer-cancel {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh-ssh-transfer-cancel:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-ssh-progress {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.dsh-ssh-progress-fill {
  height: 100%;
  width: 0;
  border-radius: 2px;
  background: var(--dsw-alias-brand-primary);
  transition: width .12s linear;
}
.dsh-ssh-progress.is-indeterminate .dsh-ssh-progress-fill {
  width: 35%;
  animation: dsh-ssh-indeterminate 1.1s ease-in-out infinite;
}
@keyframes dsh-ssh-indeterminate {
  from { transform: translateX(-100%); }
  to { transform: translateX(300%); }
}

.dsh-ssh-files-foot { display: flex; align-items: center; gap: 10px; height: 28px; flex: none; padding: 0 14px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-ssh-files-foot-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dsh-ssh-files-busy { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); }

.dsh-ssh-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px 20px; text-align: center; }
.dsh-ssh-empty-icon { color: var(--dsw-alias-label-tertiary); opacity: .8; }
.dsh-ssh-empty-icon svg { width: 34px; height: 34px; }
.dsh-ssh-empty-title { font-size: 14px; font-weight: 600; }
.dsh-ssh-empty-desc { font-size: 12px; color: var(--dsw-alias-label-tertiary); max-width: 360px; line-height: 1.55; }
.dsh-ssh-empty-action { margin-top: 6px; }

.dsh-ssh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s ease, border-color .12s ease, opacity .12s ease;
}
.dsh-ssh-btn-md { height: 30px; padding: 0 12px; }
.dsh-ssh-btn-sm { height: 26px; padding: 0 9px; font-size: 11.5px; }
.dsh-ssh-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ssh-btn:disabled { opacity: .45; cursor: not-allowed; }
.dsh-ssh-btn-primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-label-primary-foreground); }
.dsh-ssh-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsh-ssh-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); background: transparent; }
.dsh-ssh-btn-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
.dsh-ssh-btn.is-busy { opacity: .7; }
.dsh-ssh-btn.is-active { background: var(--dsw-alias-interactive-bg-active); border-color: var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); }

.dsh-ssh-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  flex: none;
}
.dsh-ssh-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-ssh-icon-btn.is-active { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
.dsh-ssh-icon-btn.is-on { color: var(--dsw-alias-state-success-primary); }
.dsh-ssh-icon-btn:disabled { opacity: .4; cursor: not-allowed; }

.dsh-ssh-input {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12.5px;
  outline: none;
}
.dsh-ssh-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dsh-ssh-select { appearance: auto; }
.dsh-ssh-field { display: flex; flex-direction: column; gap: 5px; }
.dsh-ssh-field-label { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dsh-ssh-field-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); line-height: 1.4; }
.dsh-ssh-check { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-ssh-check input { accent-color: var(--dsw-alias-brand-primary); margin: 0; }

.dsh-ssh-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-tertiary); }
.dsh-ssh-dot.is-ok { background: var(--dsw-alias-state-success-primary); }
.dsh-ssh-dot.is-pending { background: var(--dsw-alias-state-warn-primary); animation: dsh-ssh-pulse 1s ease-in-out infinite; }
.dsh-ssh-dot.is-error { background: var(--dsw-alias-state-error-primary); }
@keyframes dsh-ssh-pulse { 50% { opacity: .35; } }

.dsh-ssh-pill { display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 9px; font-size: 10.5px; font-weight: 500; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.dsh-ssh-pill.is-connected { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent); }
.dsh-ssh-pill.is-error { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); }

.dsh-ssh-spinner { display: inline-block; border: 2px solid color-mix(in srgb, currentColor 30%, transparent); border-top-color: currentColor; border-radius: 50%; animation: dsh-ssh-spin .7s linear infinite; flex: none; }
@keyframes dsh-ssh-spin { to { transform: rotate(360deg); } }

.dsh-ssh-modal-layer { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: var(--dsw-alias-bg-mask-2); pointer-events: auto; }
.dsh-ssh-modal { max-width: calc(100vw - 40px); max-height: calc(100vh - 60px); display: flex; flex-direction: column; border-radius: 14px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); overflow: hidden; }
.dsh-ssh-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 12px 10px 18px; flex: none; }
.dsh-ssh-modal-head h3 { margin: 0; font-size: 14px; font-weight: 600; }
.dsh-ssh-modal-body { padding: 4px 18px 16px; overflow-y: auto; min-height: 0; }
.dsh-ssh-modal-foot { display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--dsw-alias-border-l1); flex: none; }
.dsh-ssh-modal-spacer { flex: 1; }
.dsh-ssh-modal-text { margin: 8px 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.dsh-ssh-form { display: flex; flex-direction: column; gap: 12px; }
.dsh-ssh-form-grid.is-split { display: grid; grid-template-columns: minmax(0, 1fr) 100px; gap: 10px; }
.dsh-ssh-note { margin: 0; font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-tertiary); }
.dsh-ssh-fingerprint { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); }
.dsh-ssh-fingerprint-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-ssh-fingerprint code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; word-break: break-all; color: var(--dsw-alias-label-secondary); }
.dsh-ssh-test { padding: 8px 10px; border-radius: 8px; font-size: 11.5px; line-height: 1.5; }
.dsh-ssh-test.is-ok { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-tertiary); }
.dsh-ssh-test.is-error { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-secondary); }

.dsh-ssh-toast { position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%); z-index: 45; display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100vw - 60px)); padding: 9px 10px 9px 14px; border-radius: 10px; font-size: 12px; color: var(--dsw-alias-toast-label); background: var(--dsw-alias-toast-bg); box-shadow: var(--dsw-elevation-panel); pointer-events: auto; }
.dsh-ssh-toast.is-error { border-left: 3px solid var(--dsw-alias-state-error-primary); }
.dsh-ssh-toast.is-success { border-left: 3px solid var(--dsw-alias-state-success-primary); }
.dsh-ssh-toast button { border: 0; background: transparent; color: inherit; opacity: .7; cursor: pointer; display: inline-flex; padding: 3px; }
.dsh-ssh-mini-icon { font-size: 10px; font-weight: 600; letter-spacing: -.02em; }

.dsh-ssh-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.dsh-ssh-root ::-webkit-scrollbar-thumb { background: var(--dsh-scrollbar-thumb, var(--dsw-alias-scrollbar-bg-l2)); border-radius: 4px; }
.dsh-ssh-root ::-webkit-scrollbar-track { background: transparent; }


.dsh-ssh-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.dsh-ssh-sidebar-bar {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 8px 8px 4px;
  flex: none;
}
.dsh-ssh-sidebar-brand { display: inline-flex; color: var(--dsw-alias-brand-primary); margin: 0 2px 0 1px; }
.dsh-ssh-sidebar-brand-title { flex: 1; font-size: 13px; font-weight: 600; }
.dsh-ssh-conn-select { flex: 1; min-width: 0; height: 28px; font-size: 12px; }
.dsh-ssh-sidebar-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 8px 6px;
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-ssh-sidebar-addr {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.dsh-ssh-spacer { flex: 1; }
.dsh-ssh-sidebar-tabs { padding: 0 6px; }
.dsh-ssh-sidebar .dsh-ssh-tab { max-width: 148px; }
.dsh-ssh-sidebar .dsh-ssh-tab > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-ssh-sidebar .dsh-ssh-term-surface { margin: 4px 6px 0; border-radius: 8px; }
.dsh-ssh-sidebar .dsh-ssh-term-foot { padding: 0 8px; }
.dsh-ssh-sidebar .dsh-ssh-empty { padding: 24px 14px; }
.dsh-ssh-sidebar .dsh-ssh-toast { max-width: calc(100% - 20px); bottom: 30px; }
.dsh-ssh-files.is-compact .dsh-ssh-files-toolbar { padding: 6px; gap: 3px; }
.dsh-ssh-files.is-compact .dsh-ssh-files-body { margin: 0 6px; border-radius: 8px; }
.dsh-ssh-files.is-compact .dsh-ssh-files-head,
.dsh-ssh-files.is-compact .dsh-ssh-file-row {
  grid-template-columns: minmax(0, 1fr) 54px 84px;
  gap: 4px;
  padding: 0 6px;
}
.dsh-ssh-files.is-compact .dsh-ssh-file-actions { opacity: .4; }
.dsh-ssh-files.is-compact .dsh-ssh-file-row:hover .dsh-ssh-file-actions,
.dsh-ssh-files.is-compact .dsh-ssh-file-row:focus-within .dsh-ssh-file-actions { opacity: 1; }
.dsh-ssh-files.is-compact .dsh-ssh-files-foot { padding: 0 8px; }
.dsh-ssh-files.is-compact .dsh-ssh-path-form .dsh-ssh-input { height: 26px; font-size: 11px; }
@media (max-width: 480px) {
  .dsh-ssh-sidebar-meta .dsh-ssh-pill { display: none; }
  .dsh-ssh-sidebar-addr { max-width: 150px; }
}

@media (max-width: 860px) {
  .dsh-ssh-panel { width: calc(100vw - 20px); height: calc(100vh - 30px); }
  .dsh-ssh-side { width: 210px; }
  .dsh-ssh-main-actions .dsh-ssh-btn span { display: none; }
}
`
