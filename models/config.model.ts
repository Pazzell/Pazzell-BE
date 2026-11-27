import mongoose, { Document, Model, Schema } from "mongoose";

export interface IConfig extends Document {
  key: string;
  value: any;
  description?: string;
  updatedBy?: string;
}

const configSchema: Schema<IConfig> = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, required: true },
    description: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

const ConfigModel: Model<IConfig> = mongoose.model("Config", configSchema);
export default ConfigModel;
