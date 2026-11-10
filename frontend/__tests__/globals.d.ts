/** Globals installed by the Jest setup file. */
declare global {
  // eslint-disable-next-line no-var
  var mockApi: {
    get: jest.Mock;
    post: jest.Mock;
    put: jest.Mock;
    delete: jest.Mock;
  };
  // eslint-disable-next-line no-var
  var __mockRouteParams: Record<string, any>;
}
export {};
