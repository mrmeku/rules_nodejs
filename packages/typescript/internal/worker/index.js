/* THIS FILE GENERATED FROM .ts; see BUILD.bazel */ /* clang-format off */"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const MNEMONIC = 'TsProject';
const worker = require('./worker');
const formatHost = {
    getCanonicalFileName: path => path,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine
};
const reportDiagnostic = (diagnostic) => {
    worker.log(ts.formatDiagnostic(diagnostic, formatHost));
};
const reportWatchStatusChanged = (diagnostic) => {
    worker.debug(ts.formatDiagnostic(diagnostic, formatHost));
};
function createWatchProgram(options, tsconfigPath, setTimeout) {
    const host = ts.createWatchCompilerHost(tsconfigPath, options, Object.assign(Object.assign({}, ts.sys), { setTimeout }), ts.createEmitAndSemanticDiagnosticsBuilderProgram, reportDiagnostic, reportWatchStatusChanged);
    return ts.createWatchProgram(host);
}
let workerRequestTimestamp;
let cachedWatchedProgram;
let consolidateChangesCallback;
let cachedWatchProgramArgs;
function getWatchProgram(args) {
    const newWatchArgs = args.join(' ');
    if (cachedWatchedProgram && cachedWatchProgramArgs && cachedWatchProgramArgs !== newWatchArgs) {
        cachedWatchedProgram.close();
        cachedWatchedProgram = undefined;
        cachedWatchProgramArgs = undefined;
    }
    if (!cachedWatchedProgram) {
        const parsedArgs = ts.parseCommandLine(args);
        const tsconfigPath = process.argv[process.argv.indexOf('--project') + 1];
        cachedWatchProgramArgs = newWatchArgs;
        cachedWatchedProgram = createWatchProgram(parsedArgs.options, tsconfigPath, (callback) => {
            consolidateChangesCallback = callback;
        });
    }
    return cachedWatchedProgram;
}
function emitOnce(args) {
    const watchProgram = getWatchProgram(args);
    if (consolidateChangesCallback) {
        consolidateChangesCallback();
    }
    return new Promise((res) => {
        var _a;
        workerRequestTimestamp = Date.now();
        const result = (_a = watchProgram) === null || _a === void 0 ? void 0 : _a.getProgram().emit(undefined, undefined, {
            isCancellationRequested: (function (timestamp) {
                return timestamp !== workerRequestTimestamp;
            }).bind(null, workerRequestTimestamp),
            throwIfCancellationRequested: (function (timestamp) {
                if (timestamp !== workerRequestTimestamp) {
                    throw new ts.OperationCanceledException();
                }
            }).bind(null, workerRequestTimestamp),
        });
        res(result && result.diagnostics.length === 0);
    });
}
function main() {
    if (process.argv.includes('--persistent_worker')) {
        worker.log(`Running ${MNEMONIC} as a Bazel worker`);
        worker.runWorkerLoop(emitOnce);
    }
    else {
        worker.log(`Running ${MNEMONIC} as a standalone process`);
        worker.log(`Started a new process to perform this action. Your build might be misconfigured, try	
      --strategy=${MNEMONIC}=worker`);
        emitOnce(process.argv.slice(2)).finally(() => { var _a; return (_a = cachedWatchedProgram) === null || _a === void 0 ? void 0 : _a.close(); });
    }
}
main();
