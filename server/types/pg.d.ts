declare module "pg" {
  export class Pool {
    constructor(config?: Record<string, unknown>);
  }

  const pg: {
    Pool: typeof Pool;
  };

  export default pg;
}
