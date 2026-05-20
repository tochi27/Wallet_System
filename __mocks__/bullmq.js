const Queue = jest.fn().mockImplementation(() => ({
  add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
  close: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
}));

const Worker = jest.fn().mockImplementation(() => ({
  close: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
}));

module.exports = { Queue, Worker };
