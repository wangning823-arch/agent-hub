// Phase 1: Central route loader (non-breaking, additive for now)
// This module loads a curated set of routes into the existing Express app
// in a non-intrusive way. It allows incremental migration of routes from server.js
// to modular route files while keeping existing behavior intact.

const path = require('path')

module.exports = function registerAllRoutes(app, deps = {}) {
  // Defensive helpers to call route modules that may expose different APIs
  const callIfFn = (fn) => typeof fn === 'function' ? fn : null

  // Health Routes
  try {
    const healthModule = require('./health')
    const fn = callIfFn(healthModule?.registerHealthRoute || healthModule)
    if (fn) fn(app)
  } catch (e) {
    // ignore if not present
  }

  // Phase1 Sessions Routes
  try {
    const phase1Sessions = require('./sessions')
    // support both function export or object with registerPhase1
    let fn = null
    if (typeof phase1Sessions === 'function') fn = phase1Sessions
    else if (typeof phase1Sessions?.registerPhase1 === 'function') fn = phase1Sessions.registerPhase1
    if (fn) fn(app, deps.sessionManager)
  } catch (e) {
    // ignore if not present
  }

  // Tokens Routes
  try {
    const tokensModule = require('./tokens')
    let fn = null
    if (typeof tokensModule === 'function') fn = tokensModule
    else if (typeof tokensModule?.registerTokensRoutes === 'function') fn = tokensModule.registerTokensRoutes
    if (fn) fn(app)
  } catch (e) {
    // ignore if not present
  }

  // Projects Routes
  try {
    const projectsModule = require('./projects')
    let fn = null
    if (typeof projectsModule === 'function') fn = projectsModule
    else if (typeof projectsModule?.registerProjectsRoutes === 'function') fn = projectsModule.registerProjectsRoutes
    if (fn) fn(app)
  } catch (e) {
    // ignore if not present
  }
};
