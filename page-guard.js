(() => {
  if (globalThis.__debuggerBypassGuardInstalled) return;
  Object.defineProperty(globalThis, "__debuggerBypassGuardInstalled", {
    value: true,
    configurable: false,
  });

  const debuggerOnly = /^\s*debugger\s*;?\s*$/;
  const hasDebuggerStatement = /(?:^|[;{}])\s*debugger\s*;?/;
  const cleanSource = (source) => {
    if (typeof source !== "string") return source;
    if (debuggerOnly.test(source)) return "";
    return source.replace(/\bdebugger\s*;?/g, "void 0;");
  };

  const nativeEval = globalThis.eval;
  globalThis.eval = new Proxy(nativeEval, {
    apply(target, thisArg, args) {
      if (typeof args[0] === "string" && hasDebuggerStatement.test(args[0])) {
        args[0] = cleanSource(args[0]);
      }
      return Reflect.apply(target, thisArg, args);
    },
  });

  const wrapConstructor = (NativeConstructor) => new Proxy(NativeConstructor, {
    apply(target, thisArg, args) {
      if (args.length) args[args.length - 1] = cleanSource(args[args.length - 1]);
      return Reflect.apply(target, thisArg, args);
    },
    construct(target, args, newTarget) {
      if (args.length) args[args.length - 1] = cleanSource(args[args.length - 1]);
      return Reflect.construct(target, args, newTarget);
    },
  });

  const patchConstructorProperty = (prototype, wrapped) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    if (!descriptor) return;
    Object.defineProperty(prototype, "constructor", { ...descriptor, value: wrapped });
  };

  const NativeFunction = globalThis.Function;
  const WrappedFunction = wrapConstructor(NativeFunction);
  globalThis.Function = WrappedFunction;
  patchConstructorProperty(NativeFunction.prototype, WrappedFunction);

  const constructorPrototypes = [
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
  ];
  for (const prototype of constructorPrototypes) {
    patchConstructorProperty(prototype, wrapConstructor(prototype.constructor));
  }

  for (const timerName of ["setTimeout", "setInterval"]) {
    const nativeTimer = globalThis[timerName];
    globalThis[timerName] = new Proxy(nativeTimer, {
      apply(target, thisArg, args) {
        if (typeof args[0] === "string") args[0] = cleanSource(args[0]);
        return Reflect.apply(target, thisArg, args);
      },
    });
  }
})();
