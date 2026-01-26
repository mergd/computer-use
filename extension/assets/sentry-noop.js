const noop = () => {};
const noopObj = new Proxy({}, { get: () => noop });
export { noop as P, noop as S, noop as a, noop as g, noop as i, noopObj as w };
