import mongoose from "mongoose";
import connectDB from "../../utils/db";

describe("connectDB", () => {
  it("skips connecting when DB_URI is not set (the test suite never touches a real database)", async () => {
    expect(process.env.DB_URI).toBe("");
    const connect = jest.spyOn(mongoose, "connect");
    await connectDB();
    expect(connect).not.toHaveBeenCalled();
    connect.mockRestore();
  });
});
