// Normalize WAN 2.2 runtime parameters before any provider module reads them.
// The public Gradio Spaces currently reject inference steps above 8.
const requestedSteps = Number(process.env.WAN_STEPS || 8);
const safeSteps = Number.isFinite(requestedSteps) ? Math.min(8, Math.max(1, Math.trunc(requestedSteps))) : 8;
process.env.WAN_STEPS = String(safeSteps);

const requestedGuidance = Number(process.env.WAN_GUIDE_SCALE || 5);
if (!Number.isFinite(requestedGuidance) || requestedGuidance <= 0) {
  process.env.WAN_GUIDE_SCALE = '5';
}
