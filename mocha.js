define(function(require, exports, module) {
    main.consumes = [
        "TestRunner", "settings", "preferences", "proc", "util", "fs", "test",
        "watcher", "language", "c9", "debugger"
    ];
    main.provides = ["test.mocha"];
    return main;

    function main(options, imports, register) {
        var TestRunner = imports.TestRunner;
        // var settings = imports.settings;
        var prefs = imports.preferences;
        var proc = imports.proc;
        var util = imports.util;
        var test = imports.test;
        var fs = imports.fs;
        var c9 = imports.c9;
        var language = imports.language;
        var debug = imports["debugger"];
        var watcher = imports.watcher;
        
        var Coverage = test.Coverage;
        var File = test.File;
        
        var dirname = require("path").dirname;
        var basename = require("path").basename;
        var join = require("path").join;
        
        /***** Initialization *****/
        
        var plugin = new TestRunner("Ajax.org", main.consumes, {
            caption: "Mocha Javascript Tests",
            options: [
                {
                    title: "Enable Debugger",
                    type: "checkbox-single",
                    setting: "state/test/mocha/@debug",
                    name: "debug"
                }
            ]
        });
        // var emit = plugin.getEmitter();
        
        var DEFAULTSCRIPT = "grep -lsR -E '^\\s*describe\\(' --exclude-dir node_modules * | grep .js$";
        
        // TODO: Implement the pure find files with pattern feature in nak
        // grep -ls -E "^\\s*describe\\(" * -R --exclude-dir node_modules
        
        var lastList = "";
        var lookup = {};
        var currentPty;
        var update, debugging;
        
        function load() {
            if (test.inactive)
                return;
            prefs.add({
                "Test" : {
                    position: 1000,
                    "Mocha Test Runner" : {
                        position: 1000,
                        "Script To Fetch All Test Files In The Workspace" : {
                           name: "txtTestMocha",
                           type: "textarea-row",
                           fixedFont: true,
                           width: 600,
                           height: 200,
                           rowheight: 250,
                           position: 1000
                       },
                    }
                }
            }, plugin);
            
            plugin.getElement("txtTestMocha", function(txtTestMocha) {
                var ta = txtTestMocha.lastChild;
                
                ta.on("blur", function(e) {
                    if (test.config.mocha == ta.value) return;
                    
                    test.config.mocha = ta.value;
                    test.saveConfig(function(){
                        update();
                    });
                });
                
                test.on("ready", function(){
                    ta.setValue(test.config.mocha || DEFAULTSCRIPT);
                }, plugin);
                test.on("updateConfig", function(){
                    ta.setValue(test.config.mocha || DEFAULTSCRIPT);
                }, plugin);
            }, plugin);
        }
        
        /***** Methods *****/
        
        function fetch(cache, callback) {
            // return callback(null, "configs/client-config_test.js\nplugins/c9.api/quota_test.js\nplugins/c9.api/settings_test.js\nplugins/c9.api/sitemap-writer_test.js\nplugins/c9.api/stats_test.js\nplugins/c9.api/vfs_test.js\nplugins/c9.cli.publish/publish_test.js\nplugins/c9.analytics/analytics_test.js\nplugins/c9.api/base_test.js\nplugins/c9.api/collab_test.js\nplugins/c9.api/docker_test.js\nplugins/c9.api/package_test.js");
            // return callback(null, "classes/Twilio_TestAccounts.cls\nclasses/Twilio_TestApplication.cls\nclasses/Twilio_TestCalls.cls\nclasses/Twilio_TestCapability.cls\nclasses/Twilio_TestConference.cls\nclasses/Twilio_TestConnectApps.cls\nclasses/Twilio_TestMedia.cls\nclasses/Twilio_TestMember.cls\nclasses/Twilio_TestMessage.cls\nclasses/Twilio_TestNotification.cls\nclasses/Twilio_TestPhoneNumbers.cls\nclasses/Twilio_TestQueue.cls\nclasses/Twilio_TestRecording.cls\nclasses/Twilio_TestRest.cls\nclasses/Twilio_TestSandbox.cls\nclasses/Twilio_TestSms.cls\nclasses/Twilio_TestTwiML.cls");
            
            if (cache) 
                return callback(null, cache);
            
            var script = test.config.mocha || DEFAULTSCRIPT;
            
            if (c9.platform == "win32" && /grep/.test(script))
                return callback(null, ""); // TODO DEFAULTSCRIPT is broken on windows
            
            proc.spawn("bash", {
                args: ["-l", "-c", script],
                cwd: c9.workspaceDir
            }, function(err, p) {
                if (err) return callback(err);
                
                var stdout = "", stderr = "";
                p.stdout.on("data", function(c){
                    stdout += c;
                });
                p.stderr.on("data", function(c){
                    stderr += c;
                });
                p.on("exit", function(){
                    lastList = stdout;
                    callback(null, stdout);
                });
                
            });
        }
        
        function init(filter, cache, callback) {
            /* 
                Set hooks to update list
                - Strategies:
                    - Periodically
                    * Based on fs/watcher events
                    - Based on opening the test panel
                    - Refresh button
                
                Do initial populate
            */
            
            var isUpdating;
            update = function(cache){
                if (isUpdating) return fsUpdate(null, 10000);
                
                isUpdating = true;
                fetch(cache, function(err, list){
                    isUpdating = false;
                    
                    if (err) return callback(err);
                    
                    var items = [];
                    var lastLookup = lookup;
                    lookup = {};
                    
                    list.split("\n").forEach(function(name){
                        if (!name || filter("/" + name)) return;
                        
                        if (lastLookup[name]) {
                            items.push(lookup[name] = lastLookup[name]);
                            delete lastLookup[name];
                            return;
                        }
                        
                        var file = new File({
                            label: name,
                            path: "/" + name
                        });
                        
                        // Update file
                        file.on("change", function(e){ 
                            if (file.items.length) 
                                updateOutline(file, e.value); 
                                
                            e.run(); // Run file
                            return true;
                        });
                        
                        items.push(file);
                        lookup[name] = file;
                    });
                    
                    plugin.root.items = items;
                    
                    callback(null, items);
                });
            }
            
            var timer;
            function fsUpdate(e, time){
                clearTimeout(timer);
                timer = setTimeout(update, time || 1000);
            }
            
            function fsUpdateCheck(e){
                var reTest = new RegExp("^" + util.escapeRegExp(e.path) + "$", "m");
                
                if (lastList.match(reTest))
                    fsUpdate();
            }
            
            fs.on("afterWriteFile", fsUpdate);
            fs.on("afterUnlink", fsUpdateCheck);
            fs.on("afterRmfile", fsUpdateCheck);
            fs.on("afterRmdir", fsUpdateCheck);
            fs.on("afterCopy", fsUpdateCheck);
            fs.on("afterRename", fsUpdateCheck);
            
            // Or when a watcher fires
            watcher.on("delete", fsUpdateCheck);
            watcher.on("directory", fsUpdate);
            
            // Hook into the language
            language.registerLanguageHandler("plugins/c9.ide.test.mocha/mocha_outline_worker");
            
            // Initial Fetch
            update(cache);
        }
        
        function populate(node, callback) {
            fs.readFile(node.path, function(err, contents){
                if (err) return callback(err);
                
                updateOutline(node, contents, callback);
            });
        }
        
        var wid = 0;
        function updateOutline(node, contents, callback) {
            language.getWorker(function(err, worker) {
                if (err) return console.error(err);
                
                worker.emit("mocha_outline", { data: { id: ++wid, code: contents } });
                worker.on("mocha_outline_result", function onResponse(e) {
                    if (e.data.id !== wid) return;
                    worker.off("mocha_outline_result", onResponse);
                    
                    node.importItems(e.data.result);
                    
                    callback && callback();
                });
            });
        }
        
        function getTestNode(node, id, name){
            var count = 0;
            var found = (function recur(items, pname){
                for (var j, i = 0; i < items.length; i++) {
                    j = items[i];
                    
                    if (j.type == "test") count++;
                    if (pname + j.label == name || count == id)
                        return j;
                    
                    if (j.items) {
                        var found = recur(j.items, 
                            pname + (j.type == "testset" ? j.label + " " : ""));
                        if (found) return found;
                    }
                }
            })([node], "");
            
            // TODO optional fallback to using id
            
            return found;
        }
        
        function getFullTestName(node){
            var name = [];
            
            do {
                name.unshift(node.label);
                node = node.parent;
            } while (node.type != "file");
            
            return name.join(" ");
        }
        
        var uniqueId = 0;
        function run(node, progress, options, callback){
            if (typeof options == "function")
                callback = options, options = null;
            
            var fileNode;
            var exec = "mocha", args = ["--reporter", "tap"];
            
            var allTests = node.findAllNodes("test");
            var allTestIndex = 0;
            
            if (node.type == "file") {
                fileNode = node;
                progress.start(allTests[allTestIndex] || node);
            }
            else {
                fileNode = node.findFileNode();
                progress.start(node.type == "test" ? node : allTests[allTestIndex]);
                
                args.push("--grep", util.escapeRegExp(getFullTestName(node))  //"^" + 
                    + (node.type == "test" ? "$" : ""));
            }
            
            fileNode.ownPassed = null;
            fileNode.output = "";
            
            var withCodeCoverage = options && options.withCodeCoverage;
            var withDebug = options && options.debug;
            
            if (!withCodeCoverage && withDebug) {
                // "${debug?--nocrankshaft}",
                // "${debug?--nolazy}",
                // "${debug?`node --version | grep -vqE \"v0\\..\\.\" && echo --nodead_code_elimination`}",
                // "${debug?--debug-brk=15454}",
                
                args.push("--debug", "--debug-brk=15455"); // TODO extra node options
                
                debugging = true;
                debug.debug({
                    STARTED: 2,
                    runner: {
                        "debugger": "v8",
                        "debugport": 15455,
                        "disabled": {
                            liveUpdate: true
                        }
                    },
                    running: 2,
                    name: plugin.root.label,
                    meta: { $debugger: true }
                }, false, function(err) {
                    if (err)
                        return (debugging = false); // Either the debugger is not found or paused
                });
            }
            
            var path = join(c9.workspaceDir, fileNode.path);
            args.push(path);
            
            var coveragePath = "~/.c9/coverage/run" + (++uniqueId);
            var isWin = c9.platform == "win32";
            if (withCodeCoverage) {
                exec = "istanbul";
                args.unshift("cover", "--print", "none", "--report", 
                    "lcovonly", "--dir", coveragePath, 
                    isWin ? "node_modules/mocha/bin/_mocha" : "_mocha", "--");
            }
            if (isWin) {
                args.unshift("-c", '"$0" "$@"', exec);
                exec = "bash.exe";
            }
            
            proc.pty(exec, {
                args: args,
                cwd: dirname(path),
                fakePty: isWin
            }, function(err, pty){
                if (err) return callback(err);
                
                currentPty = pty;
                
                var lastResultNode, testCount, bailed;
                var output = "", totalTests = 0;
                pty.on("data", function(c){
                    // Log to the raw viewer
                    progress.log(fileNode, c);
                    
                    // Number of tests
                    if (c.match(/^(\d+)\.\.(\d+)$/m)) {
                        testCount = parseInt(RegExp.$2, 10);
                    }
                    
                    // Bail
                    else if (c.match(/^Bail out!(.*)$/m)) {
                        bailed = 3; // RegExp.$1;
                    }
                    
                    // Update parsed nodes (set, test)
                    else if (c.match(/^(ok|not ok)\s+(\d+)\s+(.*)$/m)) {
                        var pass = RegExp.$1 == "ok" ? 1 : 0;
                        var id = RegExp.$2;
                        var name = RegExp.$3;
                        
                        if (name.match(/"(before all|before each|after all|after each)" hook/, "$1")) {
                            name = name.replace(/"(before all|before each|after all|after each)" hook/, "$1");
                            if (!pass) bailed = 2, pass = 2;
                        }
                        
                        // Update Node
                        var resultNode = (node.type == "test"
                            ? node
                            : getTestNode(node, id, name)) 
                        
                        if (!resultNode) {
                            resultNode = fileNode.addTest({
                                label: name, // TODO
                                type: "test"
                            });
                        }
                        
                        // if (!resultNode) 
                        //     resultNode = lastResultNode 
                        //         || node.findAllNodes("test")[0];
                        
                        // if (!resultNode)
                        //     return (bailed = 2); // TODO test this
                        
                        lastResultNode = resultNode;
                        
                        // Set Results
                        resultNode.output = output;
                        resultNode.passed = pass;
                        resultNode.annotations = null;
                    
                        // Reset output
                        output = "";
                        
                        // Count the tests
                        totalTests++;
                        
                        // Update progress
                        progress.end(resultNode);
                        
                        if (bailed) return;
                        
                        var nextTest = allTests[++allTestIndex]; //findNextTest(resultNode);
                        if (nextTest) progress.start(nextTest);
                    }
                    
                    // Output
                    else {
                        var stackTrace;
                        
                        // Detect stack trace or timeout
                        if (c.match(/^\s*Error: timeout/) || c.match(/^\s+at .*:\d+:\d+\)?$/m)) {
                            if (!lastResultNode) {
                                lastResultNode = fileNode; // getTestNode(fileNode, 1);
                                fileNode.ownPassed = 2;
                                fileNode.output = c;
                                return;
                            }
                            
                            if (c.match(/^\s*Error: timeout/)) {
                                lastResultNode.output = c;
                            }
                            else {
                                stackTrace = parseTrace(c);
                                if (stackTrace) {
                                    if (!withCodeCoverage) {
                                        if (!lastResultNode.annotations) 
                                            lastResultNode.annotations = [];
                                        
                                        var path = join(c9.workspaceDir, fileNode.path);
                                        var pos = stackTrace.findPath(path);
                                        if (!pos) 
                                            lastResultNode.output += c;
                                        else {
                                            lastResultNode.annotations.push({
                                                line: pos.lineNumber,
                                                column: pos.column,
                                                message: stackTrace.message
                                            });
                                        }
                                    }
                                    else 
                                        lastResultNode.output += c;
                                }
                            }
                            return;
                        }
                        
                        output += c.replace(/^# (?:tests|pass|fail).*$/mg, "").trimRight();
                    }
                });
                pty.on("exit", function(c){
                    currentPty = null;
                    
                    if (output) {
                        if (lastResultNode) 
                            lastResultNode.output += output;
                        else
                            fileNode.output = output;
                            
                        output = "";
                    }
                    
                    // Special Case for Syntax Errors
                    if (fileNode.output.indexOf("SyntaxError:") > -1) {
                        var stackTrace = parseTrace(fileNode.output);
                        var filepath = isWin ? fileNode.path.replace(/\//g, "\\") : fileNode.path;
                        var rePath = new RegExp(util.escapeRegExp(filepath) + ":(\\d+)");
                        fileNode.output.match(rePath);
                        if (RegExp.$1) {
                            if (!fileNode.annotations) 
                                fileNode.annotations = [];
                            
                            var lineNumber = parseInt(RegExp.$1);
                            fileNode.annotations.push({
                                line: lineNumber,
                                column: 0,
                                message: "SyntaxError:" + stackTrace.message.split("SyntaxError:")[1]
                            });
                            fileNode.output = stackTrace.message + "\n" 
                                + fileNode.path.substr(1) + ":" + lineNumber;
                            fileNode.ownPassed = 3;
                        }
                    }
                    
                    if (testCount !== totalTests) {
                        if (!pty.isKilled)
                            fileNode.ownPassed = 2;
                    }
                    else if (bailed || pty.isKilled)
                        fileNode.ownPassed = pty.isKilled ? 3 : bailed;
                    
                    if (withCodeCoverage && !bailed) {
                        fs.readFile(coveragePath + "/lcov.info", function(err, lcovString){
                            if (err) return done(err);
                            
                            node.coverage = Coverage.fromLCOV(lcovString, coveragePath);
                            
                            done();
                        });
                    }
                    else {
                        node.coverage = null;
                        done();
                    }
                    
                    function done(err){
                        // Cleanup for before/after failure
                        allTests.forEach(function(n){ 
                            if (n.status != "loaded")
                                progress.end(n);
                        });
                        
                        callback(err, node);
                    }
                });
            });
            
            return stop;
        }
        
        /**
         * This parses the different stack traces and puts them into one format
         * This borrows heavily from TraceKit (https://github.com/occ/TraceKit)
         * From: https://github.com/errwischt/stacktrace-parser/blob/master/lib/stacktrace-parser.js
         */
        var UNKNOWN_FUNCTION = '<unknown>';
        function parseTrace(stackString){
            var node  = /^\s*at (?:((?:\[object object\])?\S+(?: \[as \S+\])?) )?\(?(.*?):(\d+)(?::(\d+))?\)?\s*$/i;
            var lines = stackString.split('\n');
            var stack = [];
            var message = [];
            var parts, started;
        
            for (var i = 0, j = lines.length; i < j; ++i) {
                if ((parts = node.exec(lines[i]))) {
                    stack.push({
                        'file': parts[2],
                        'methodName': parts[1] || UNKNOWN_FUNCTION,
                        'lineNumber': +parts[3],
                        'column': parts[4] ? +parts[4] : null
                    });
                    started = true;
                } 
                else if (!started) {
                    message.push(lines[i]);
                }
            }
            
            stack.message = message.join("\n");
            
            if ((stack.message + stack[0].file).indexOf("mocha/lib/runner.js") > -1)
                return false;
            
            stack.findPath = function(path, isFilename){
                for (var i = 0; i < stack.length; i++) {
                    if (stack[i].file == path)
                        return stack[i];
                }
                return isFilename ? false : this.findPath(basename(path), true);
            };
        
            return stack;
        }
        
        function stop(){
            if (currentPty) {
                currentPty.isKilled = true;
                currentPty.kill();
            }
            
            if (debugging)
                debug.stop();
        }
        
        var reStack = /([\\\/\w-_\.]+):(\d+)(?::(\d+))?/g;
        function parseLinks(strOutput){
            return strOutput.replace(reStack, function(m, name, l, c){ 
                name = name.replace(c9.workspaceDir, "");
                if (name.charAt(0) != "/") name = "/" + name;
                
                var link = name + ":" + (l - 1) + (c ? ":" + c : "");
                return "<span class='link' link='" + link + "'>" + m + "</span>";
            });
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function() {
            load();
        });
        plugin.on("unload", function() {
            
        });
        
        /***** Register and define API *****/
        
        plugin.freezePublicAPI({
            /**
             * 
             */
            init: init,
            
            /**
             * 
             */
            populate: populate,
            
            /**
             * 
             */
            get update(){ return update },
            
            /**
             * 
             */
            parseLinks: parseLinks,
            
            /**
             * 
             */
            run: run,
            
            /**
             * 
             */
            stop: stop
        });
        
        register(null, {
            "test.mocha": plugin
        });
    }
});