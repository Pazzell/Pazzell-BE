import userModel from "../models/user.model";

export const generateUsername = async (email: string): Promise<string> => {
  const baseUsername = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");

  let username = baseUsername;
  let counter = 1;

  while (await userModel.findOne({ username })) {
    username = `${baseUsername}${counter}`;
    counter++;
  }

  return username;
};

export const generateAvatar = (nameOrEmail: string): string => {
  // Generate unique avatar using UI Avatars with user's name/email
  const colors = ["FF6B6B", "4ECDC4", "45B7D1", "FFA07A", "98D8C8", "F7DC6F", "BB8FCE", "85C1E2"];

  // Use a simple hash to consistently pick a color based on the input
  let hash = 0;
  for (let i = 0; i < nameOrEmail.length; i++) {
    hash = nameOrEmail.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % colors.length;
  const backgroundColor = colors[colorIndex];

  // Extract name for initials - if it's an email, use the part before @
  const displayName = nameOrEmail.includes('@')
    ? nameOrEmail.split('@')[0]
    : nameOrEmail;

  // Encode the name for URL safety
  const encodedName = encodeURIComponent(displayName);

  return `https://ui-avatars.com/api/?background=${backgroundColor}&color=fff&bold=true&size=200&name=${encodedName}`;
};
