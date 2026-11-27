import mongoose, { Document, Model, Schema } from "mongoose";

// Every image the API has stored, keyed by who uploaded it. Cards, covers and logos
// may only reference an imageUrl that appears here for the same owner, so nobody can
// point a card at an arbitrary external URL.
export interface IUploadedImage extends Document {
  ownerId: string;
  url: string;
  storageKey: string;
  folder: string;
  width: number;
  height: number;
  sizeBytes: number;
}

const uploadedImageSchema: Schema<IUploadedImage> = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    url: { type: String, required: true, unique: true },
    storageKey: { type: String, required: true },
    folder: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    sizeBytes: { type: Number, required: true },
  },
  { timestamps: true }
);

const UploadedImageModel: Model<IUploadedImage> = mongoose.model(
  "UploadedImage",
  uploadedImageSchema
);
export default UploadedImageModel;
