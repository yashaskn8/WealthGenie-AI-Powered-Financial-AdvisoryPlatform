/**
 * Allocate one monotonic event sequence per AgentRun. The first allocation
 * seeds from the existing event tail so older runs remain compatible after
 * the atomic allocator is introduced.
 */
export async function allocateAgentRunEventSequence({ runModel, eventModel, runId, userId, executionGeneration = null } = {}) {
  if (!runModel?.findOneAndUpdate || !runId || !userId) return null;
  const baseFilter = { runId, userId };
  if (executionGeneration !== null && executionGeneration !== undefined) baseFilter.executionGeneration = executionGeneration;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await runModel.findOne(baseFilter).lean();
    if (!current) return null;
    const latest = eventModel?.findOne
      ? await eventModel.findOne({ runId, userId }).sort({ sequence: -1 }).lean()
      : null;
    if (Number(current.eventSequence || 0) < Number(latest?.sequence || 0)) {
      await runModel.findOneAndUpdate(
        baseFilter,
        { $max: { eventSequence: Number(latest.sequence) } },
        { new: true },
      ).lean();
    }
    const updated = await runModel.findOneAndUpdate(
      baseFilter,
      { $inc: { eventSequence: 1 } },
      { new: true },
    ).lean();
    if (Number.isInteger(updated?.eventSequence) && updated.eventSequence > 0) return updated.eventSequence;
  }
  return null;
}
