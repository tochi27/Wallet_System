// Utility function for validating amount
export const validateAmount = (amount: any): number => {
  if (amount === undefined || amount === null) {
    throw new Error("Amount is required");
  }

  const parsedAmount = Number(amount);
  if (isNaN(parsedAmount)) {
    throw new Error("Amount must be a number");
  }

  if (parsedAmount <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  return parsedAmount;
};