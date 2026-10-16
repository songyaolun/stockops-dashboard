(function () {
  "use strict";

  const data = window.__STOCKOPS_DATA__ || {};
  const navigation = data.navigation || {};
  const workspaces = new Set(["stage", "research", "candidates"]);

  /**
   * Return the candidate count visible under the requested ranking identity.
   * Input example: a mismatched snapshot_id. Output example: 0, matching app.js.
   */
  function visibleCandidateCount() {
    const ranking = data.ranking_snapshot || {};
    const requested = new URLSearchParams(window.location.search).get("snapshot_id");
    if (
      ranking.mode === "canonical"
      && requested
      && requested !== String(ranking.snapshot_id || "")
    ) {
      return 0;
    }
    return Array.isArray(data.screen_results) ? data.screen_results.length : 0;
  }

  /**
   * Mount every business, stage, and home link from the frozen run payload.
   * Input example: navigation.business.candidates="dashboard.html?workspace=candidates".
   * Output example: the candidates anchor receives that href; missing targets are hidden.
   */
  function mountNavigation() {
    const business = navigation.business || {};
    const stages = navigation.stages || {};
    for (const link of document.querySelectorAll("[data-business-link]")) {
      const href = business[link.dataset.businessLink];
      link.href = href || "#";
      link.hidden = !href;
    }
    for (const link of document.querySelectorAll("[data-stage-link]")) {
      const href = stages[link.dataset.stageLink];
      link.href = href || "#";
      link.dataset.baseHref = href || "#";
      link.hidden = !href;
      link.setAttribute(
        "aria-current",
        navigation.current_task === link.dataset.stageLink ? "page" : "false"
      );
    }
    for (const link of document.querySelectorAll("[data-home-link]")) {
      link.href = navigation.home || "#";
    }
  }

  /**
   * Activate one supported workspace and preserve it while changing stages.
   * Input example: "candidates". Output example: only #candidate-workspace is visible.
   */
  function activateWorkspace(value) {
    const target = workspaces.has(value) ? value : "stage";
    const ids = {
      stage: "stage-workspace",
      research: "research-workspace",
      candidates: "candidate-workspace",
    };
    for (const [workspace, id] of Object.entries(ids)) {
      document.getElementById(id).hidden = workspace !== target;
    }
    for (const button of document.querySelectorAll("[data-workspace]")) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.workspace === target)
      );
    }
    for (const link of document.querySelectorAll("[data-stage-link]")) {
      const base = link.dataset.baseHref || "#";
      if (base !== "#") {
        link.href = `${base.split("?")[0]}?workspace=${encodeURIComponent(target)}`;
      }
    }
    window.dispatchEvent(new Event("resize"));
    window.scrollTo(0, 0);
  }

  /**
   * Bind workspace controls and open the requested supported workspace.
   * Input example: ?workspace=research. Output example: the research tab is active.
   */
  function initializeWorkspaceNavigation() {
    mountNavigation();
    const count = document.getElementById("candidate-workspace-count");
    if (count) {
      count.textContent = `${visibleCandidateCount()} 只候选`;
    }
    for (const button of document.querySelectorAll("[data-workspace]")) {
      button.addEventListener(
        "click",
        () => activateWorkspace(button.dataset.workspace)
      );
    }
    for (const button of document.querySelectorAll("[data-stage-deep-link]")) {
      button.addEventListener(
        "click",
        () => activateWorkspace(button.dataset.stageDeepLink)
      );
    }
    const requested = new URLSearchParams(window.location.search).get("workspace");
    activateWorkspace(requested);
  }

  initializeWorkspaceNavigation();
})();
