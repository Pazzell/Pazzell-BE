import { Model } from "mongoose";
import TriviaCardModel from "../../models/triviaCard.model";
import CustomQuizCardModel from "../../models/customQuizCard.model";
import CampaignCardModel from "../../models/campaignCard.model";
import { genericImagePrompt } from "./imagePrompt";

const CARD_MODELS: Record<string, Model<any>> = {
  topicCards: TriviaCardModel,
  customQuizCards: CustomQuizCardModel,
  campaignCards: CampaignCardModel,
};

export interface PromptChange {
  from: string;
  to: string;
  count: number;
}

/**
 * Rewrites the captions of existing image cards to the generic form (see imagePrompt.ts).
 * With `apply` false it only reports what would change. Session snapshots are left alone.
 */
export async function makeImagePromptsGeneric(apply: boolean) {
  const report: Record<string, PromptChange[]> = {};
  for (const [name, model] of Object.entries(CARD_MODELS)) {
    const captions: string[] = await model.distinct("text", { type: "image", text: { $nin: [null, ""] } });
    const changes: PromptChange[] = [];
    for (const from of captions) {
      const to = genericImagePrompt(from)!;
      if (to === from) continue;
      const filter = { type: "image", text: from };
      const count = apply
        ? (await model.updateMany(filter, { $set: { text: to } })).modifiedCount
        : await model.countDocuments(filter);
      changes.push({ from, to, count });
    }
    report[name] = changes;
  }
  return report;
}
