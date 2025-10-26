import { Response } from 'express'

export const successResponse = (res: Response, message: string, data?: any, code: number = 200) => {
  return res.status(code).json({ success: true, message, data });
};

export const errorResponse = (res: Response, message: string, code: number = 400) => {
  return res.status(code).json({ success: false, message });
};
