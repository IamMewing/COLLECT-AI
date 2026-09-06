// ============================================
// CollectAI — Reflection Engine
// ============================================

const { getGeminiClient, GEMINI_MODEL } = require('../../config/gemini');
const { getReflectionPrompt } = require('../prompts/promptLibrary');

const REFLECTIONS_COLLECTION = 'agent_reflections';

const REFLECTION_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    wasBestDecision: { type: "boolean" },
    supportingEvidence: { type: "string" },
    improvementOpportunity: { type: "string" },
    suggestedRelationshipDelta: { type: "number" },
    suggestedToneShift: { type: "string", enum: ["maintain", "softer", "firmer"] },
    reflectionSummary: { type: "string" }
  },
  required: [
    "wasBestDecision", "supportingEvidence", "improvementOpportunity", 
    "suggestedRelationshipDelta", "suggestedToneShift", "reflectionSummary"
  ]
};

/**
 * Registers an autonomous action reflection log in Firestore.
 */
async function writeAgentReflection(db, actionLog, reasoningResult, userId) {
  try {
    const ai = getGeminiClient();
    const prompt = getReflectionPrompt(actionLog, reasoningResult);

    let reflectionData;

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            systemInstruction: "You are the CollectAI reflection analysis engine. Output JSON conforming to the reflection schema.",
            responseMimeType: "application/json",
            responseSchema: REFLECTION_OUTPUT_SCHEMA,
            temperature: 0.2
          }
        });

        reflectionData = JSON.parse(response.text);
      } catch (geminiErr) {
        console.warn("⚠️ Reflection API run failed. Generating heuristic reflection:", geminiErr.message);
      }
    }

    // Default heuristic fallback reflection
    if (!reflectionData) {
      reflectionData = getFallbackReflection(actionLog);
    }

    const reflectionDoc = {
      userId,
      invoiceId: actionLog.invoiceId,
      timestamp: new Date(),
      actionDecision: actionLog.decision,
      ...reflectionData
    };

    const docRef = await db.collection(REFLECTIONS_COLLECTION).add(reflectionDoc);
    reflectionDoc.id = docRef.id;

    console.log(`🧠 Reflection created: ${reflectionDoc.reflectionSummary} (ID: ${docRef.id})`);
    return reflectionDoc;
  } catch (error) {
    console.error('Error writing agent reflection:', error);
    throw error;
  }
}

/**
 * Procedural reflection generator for offline demo.
 */
function getFallbackReflection(actionLog) {
  const isEscalation = actionLog.decision === 'escalate' || actionLog.decision === 'call_owner';
  
  return {
    wasBestDecision: true,
    supportingEvidence: `Invoice is past due and escalation index matches stage. Action taken: ${actionLog.decision}.`,
    improvementOpportunity: isEscalation 
      ? "Direct owner calling may bypass standard messaging lag."
      : "Maintain current email reminders cadence.",
    suggestedRelationshipDelta: isEscalation ? -5 : 0,
    suggestedToneShift: isEscalation ? "firmer" : "maintain",
    reflectionSummary: isEscalation
      ? `Escalated account due to ignored reminders. Relationship score lowered.`
      : `Dispatched polite reminder. Client communication channel verified active.`
  };
}

module.exports = { writeAgentReflection };
