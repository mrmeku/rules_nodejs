/**
 * @fileoverview wrapper program around the TypeScript compiler, tsc
 *
 * It intercepts the Bazel Persistent Worker protocol, using it to remote-control tsc running as a
 * child process. In between builds, the tsc process is stopped (akin to ctrl-z in a shell) and then
 * resumed (akin to `fg`) when the inputs have changed.
 *
 * See https://medium.com/@mmorearty/how-to-create-a-persistent-worker-for-bazel-7738bba2cabb
 * for more background (note, that is documenting a different implementation)
 */
import * as ts from 'typescript';
const MNEMONIC = 'TsProject';
const worker = require('./worker');

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: path => path,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine
};

/**
 * Prints a diagnostic result for every compiler error or warning.
 */
const reportDiagnostic: ts.DiagnosticReporter = (diagnostic) => {
  worker.log(ts.formatDiagnostic(diagnostic, formatHost));
};

/**
 * Prints a diagnostic every time the watch status changes.
 * This is mainly for messages like "Starting compilation" or "Compilation completed".
 */
const reportWatchStatusChanged: ts.WatchStatusReporter = (diagnostic) => {
  worker.debug(ts.formatDiagnostic(diagnostic, formatHost));
};


function createWatchProgram(
    options: ts.CompilerOptions, tsconfigPath: string, setTimeout: ts.System['setTimeout']) {
  const host = ts.createWatchCompilerHost(
      tsconfigPath, options, {...ts.sys, setTimeout},
      ts.createEmitAndSemanticDiagnosticsBuilderProgram, reportDiagnostic,
      reportWatchStatusChanged);

  // `createWatchProgram` creates an initial program, watches files, and updates
  // the program over time.
  return ts.createWatchProgram(host);
}

/**
 * Timestamp of the last worker request.
 */
let workerRequestTimestamp: number|undefined;
/**
 * The typescript compiler in watch mode.
 */
let cachedWatchedProgram: ts.WatchOfConfigFile<ts.EmitAndSemanticDiagnosticsBuilderProgram>|
    undefined;
/**
 * Callback provided by ts.System which should be called at the point at which
 * file system changes should be consolidated into a new emission from the
 * watcher.
 */
let consolidateChangesCallback: ((...args: any[]) => void)|undefined;
let cachedWatchProgramArgs: string|undefined;

function getWatchProgram(args: string[]):
    ts.WatchOfConfigFile<ts.EmitAndSemanticDiagnosticsBuilderProgram> {
  const newWatchArgs = args.join(' ');

  // Check to see if the watch program needs to be updated or if we can re-use the old one.
  if (cachedWatchedProgram && cachedWatchProgramArgs && cachedWatchProgramArgs !== newWatchArgs) {
    cachedWatchedProgram.close();
    cachedWatchedProgram = undefined;
    cachedWatchProgramArgs = undefined;
  }

  // If we have not yet created a watch
  if (!cachedWatchedProgram) {
    const parsedArgs = ts.parseCommandLine(args);
    const tsconfigPath = process.argv[process.argv.indexOf('--project') + 1];

    cachedWatchProgramArgs = newWatchArgs
    cachedWatchedProgram = createWatchProgram(parsedArgs.options, tsconfigPath, (callback) => {
      consolidateChangesCallback = callback;
    });
  }

  return cachedWatchedProgram;
}

function emitOnce(args: string[]) {
  const watchProgram = getWatchProgram(args);

  if (consolidateChangesCallback) {
    consolidateChangesCallback();
  }

  return new Promise((res) => {
    workerRequestTimestamp = Date.now();
    const result = watchProgram?.getProgram().emit(undefined, undefined, {
      isCancellationRequested: (function(timestamp: number) {
                                 return timestamp !== workerRequestTimestamp
                               }).bind(null, workerRequestTimestamp),
      throwIfCancellationRequested: (function(timestamp: number) {
                                      if (timestamp !== workerRequestTimestamp) {
                                        throw new ts.OperationCanceledException();
                                      }
                                    }).bind(null, workerRequestTimestamp),
    });

    res(result && result.diagnostics.length === 0);
  })
}


function main() {
  if (process.argv.includes('--persistent_worker')) {
    worker.log(`Running ${MNEMONIC} as a Bazel worker`);
    worker.runWorkerLoop(emitOnce);
  }
  else {
    worker.log(`Running ${MNEMONIC} as a standalone process`);
    worker.log(
        `Started a new process to perform this action. Your build might be misconfigured, try	
      --strategy=${MNEMONIC}=worker`);

    emitOnce(process.argv.slice(2)).finally(() => cachedWatchedProgram?.close());
  }
}

main();