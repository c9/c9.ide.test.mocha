define(function(require, exports, module) {
    main.consumes = [
        "TestRunner", "settings", "preferences", "proc", "util", "fs", 
        "watcher", "language"
    ];
    main.provides = ["test.mocha"];
    return main;

    function main(options, imports, register) {
        var TestRunner = imports.TestRunner;
        // var settings = imports.settings;
        // var prefs = imports.preferences;
        var proc = imports.proc;
        var util = imports.util;
        var fs = imports.fs;
        var language = imports.language;
        var watcher = imports.watcher;
        
        var dirname = require("path").dirname;
        var parseLcov = require("./lcov-parse");
        
        /***** Initialization *****/
        
        var plugin = new TestRunner("Ajax.org", main.consumes, {
            caption: "Mocha Javascript Tests"
        });
        // var emit = plugin.getEmitter();
        
        var SCRIPT = "";
        var MATCH_PATTERN = '^\\s*describe\\(';
        var INCLUDE_PATTERN = "";
        var EXCLUDE_PATTERN = 'node_modules';
        var EXCLUDE_LIST = [];
        
        // TODO: Implement the pure find files with pattern feature in nak
        // grep -ls -E "^\\s*describe\\(" * -R --exclude-dir node_modules
        
        var lastList = "";
        var lookup = {};
        var currentPty;
        
        function load() {
            // Potentially listen to the save event and run specific tests
            
            // prefs...
            
        }
        
        /***** Methods *****/
        
        function fetch(callback) {
            var cmd, args;
            
            return callback(null, "plugins/c9.analytics/analytics_test.js\nplugins/c9.api/base_test.js\nplugins/c9.api/collab_test.js\nplugins/c9.api/docker_test.js\nplugins/c9.api/package_test.js\nplugins/c9.api/quota_test.js\nplugins/c9.api/settings_test.js\nplugins/c9.api/sitemap-writer_test.js\nplugins/c9.api/stats_test.js\nplugins/c9.api/vfs_test.js");
            
            if (SCRIPT) {
                args = SCRIPT.split(" ");
                cmd = args.shift();
            }
            else {
                cmd = "grep";
                args = ["-lsR", "-E", MATCH_PATTERN];
                
                if (EXCLUDE_PATTERN)
                    args.push("--exclude-dir", EXCLUDE_PATTERN);
                    
                if (INCLUDE_PATTERN)
                    args.push("--include", INCLUDE_PATTERN);
            }
            
            proc.spawn("bash", {
                args: ["-l", "-c", cmd + " '" + args.join("' '") + "' *"]
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
                    // if (!SCRIPT) {
                    //     var filter = new RegExp("^(?:"
                    //         + EXCLUDE_LIST.map(util.escapeRegExp).join("|") 
                    //         + ")(?:\n|$)", "gm");
                        
                    //     stdout = stdout.replace(stdout, filter);
                    // }
                    
                    lastList = stdout;
                    
                    callback(null, stdout);
                });
                
            });
        }
        
        function init(root, callback) {
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
            function update(){
                if (isUpdating) return fsUpdate(null, 10000);
                
                isUpdating = true;
                fetch(function(err, list){
                    isUpdating = false;
                    
                    if (err) return callback(err);
                    
                    var items = [];
                    var lastLookup = lookup;
                    lookup = {};
                    
                    list.split("\n").forEach(function(name){
                        if (lastLookup[name]) {
                            items.push(lookup[name] = lastLookup[name]);
                            delete lastLookup[name];
                            return;
                        }
                        
                        var item = {
                            label: name,
                            path: "/" + name,
                            type: "file",
                            status: "pending"
                        };
                        items.push(item);
                        lookup[name] = item;
                    });
                    
                    plugin.root.items = items;
                    
                    callback();
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
            update();
        }
        
        var wid = 0;
        function populate(node, callback) {
            fs.readFile(node.path, function(err, contents){
                if (err) return callback(err);
                
                // Invoke in the UI like:
                language.getWorker(function(err, worker) {
                    worker.emit("mocha_outline", { data: { id: ++wid, code: contents } });
                    worker.on("mocha_outline_result", function onResponse(e) {
                        if (e.data.id !== wid) return;
                        worker.off("mocha_outline_result", onResponse);
                        
                        node.items = e.data.result;
                        
                        callback();
                    });
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
                            pname + (j.type == "describe" ? j.label + " " : ""));
                        if (found) return found;
                    }
                }
            })([node], "");
            
            // TODO optional fallback to using id
            
            return found;
        }
        
        function findNextTest(node){
            return (function recur(node, down){
                if (!node.parent) return false;
                
                var i, items;
                if (down) {
                    items = node.items;
                    i = 0;
                }
                else {
                    i = node.parent.items.indexOf(node) + 1;
                    node = node.parent;
                    items = node.items;
                }
                
                for (var j; i < items.length; i++) {
                    j = items[i];
                    
                    if (j.type == "test" || j.type == "prepare")
                        return j;
                    
                    if (j.items) {
                        var found = recur(j, true);
                        if (found) return found;
                    }
                }
                
                return recur(node);
            })(node, node.type != "test");
        }
        
        function findFileNode(node){
            while (node.type != "file") node = node.parent;
            return node;
        }
        
        function getFullTestName(node){
            var name = [];
            
            do {
                name.unshift(node.label)
                node = node.parent;
            } while (node.type != "file");
            
            return name.join(" ");
        }
        
        function getAllTestNodes(node){
            var nodes = [];
            (function recur(items){
                for (var j, i = 0; i < items.length; i++) {
                    j = items[i];
                    if (j.type == "test") nodes.push(j);
                    else if (j.items) recur(j.items);
                }
            })([node]);
            
            return nodes;
        }
        
        var uniqueId = 0;
        function run(node, progress, options, callback){
            if (typeof options == "function")
                callback = options, options = null;
            
            var fileNode, path, passed = true;
            var exec = "mocha", args = ["--reporter", "tap"];
            
            var allTests = getAllTestNodes(node);
            var allTestIndex = 0;
            
            if (!allTests.length) return callback();
            
            if (node.type == "file") {
                fileNode = node;
                progress.start(allTests[allTestIndex]);
            }
            else {
                fileNode = findFileNode(node);
                progress.start(node.type == "test" ? node : allTests[allTestIndex]);
                
                args.push("--grep", util.escapeRegExp(getFullTestName(node))  //"^" + 
                    + (node.type == "test" ? "$" : ""));
            }
            
            // TODO: --debug --debug-brk
            args.push(fileNode.label);
            
            var withCodeCoverage = options && options.withCodeCoverage;
            var coveragePath = "~/.c9/coverage/run" + ++uniqueId;
            if (withCodeCoverage) {
                exec = "istanbul";
                args.unshift("cover", "--print", "none", "--report", 
                    "lcovonly", "--dir", coveragePath, "_mocha", "--");
            }
            
            proc.pty(exec, {
                args: args,
                cwd: dirname(path)
            }, function(err, pty){
                if (err) return callback(err);
                
                currentPty = pty;
                
                var lastResultNode, testCount, bailed;
                var output = "", totalTests = 0;
                pty.on("data", function(c){
                    // Log to the raw viewer
                    progress.log(c);
                    
                    // Number of tests
                    if (c.match(/^(\d+)\.\.(\d+)$/m)) {
                        testCount = parseInt(RegExp.$2, 10);
                    }
                    
                    // Bail
                    else if (c.match(/^Bail out!(.*)$/m)) {
                        bailed = RegExp.$1;
                    }
                    
                    // Update parsed nodes (set, test)
                    else if (c.match(/^(ok|not ok)\s+(\d+)\s+(.*)$/m)) {
                        var pass = RegExp.$1 == "ok" ? 1 : 0;
                        var id = RegExp.$2;
                        var name = RegExp.$3;
                        
                        if (name.match(/"(before all|before each|after all|after each)" hook/, "$1")) {
                            name = name.replace(/"(before all|before each|after all|after each)" hook/, "$1");
                            if (!pass) bailed = true, pass = 2;
                        }
                        
                        // Set file passed state
                        if (!pass) passed = false;
                        
                        // Update Node
                        var resultNode = node.type == "test"
                            ? node
                            : getTestNode(node, id, name);
                        
                        if (resultNode) {
                            lastResultNode = resultNode;
                            
                            // Set Results
                            resultNode.output = output;
                            resultNode.passed = pass;
                            delete resultNode.stackTrace;
                            // resultNode.assertion = {
                            //     line: 0,
                            //     col: 10,
                            //     message: ""
                            // };
                        
                            // Reset output
                            output = "";
                            
                            // Count the tests
                            totalTests++;
                            
                            // Update progress
                            progress.end(resultNode);
                        }
                        else {
                            debugger;
                        }
                        
                        if (bailed) return;
                        
                        var nextTest = allTests[++allTestIndex]; //findNextTest(resultNode);
                        if (nextTest) progress.start(nextTest);
                    }
                    
                    // Output
                    else {
                        // Detect stack trace
                        if (c.match(/^\s+at .*:\d+:\d+\)?$/m)) {
                            if (!lastResultNode.stackTrace) {
                                lastResultNode.stackTrace = parseTrace(c);
                            }
                            else if (c.indexOf("mocha/lib/runner.js") == -1) {
                                lastResultNode.output += c;
                            }
                            return;
                        }
                        
                        output += c;
                    }
                });
                pty.on("exit", function(c){
                    // totalTests == testCount
                    currentPty = null;
                    
                    if (withCodeCoverage) {
                        fs.readFile(coveragePath + "/lcov.info", function(err, data){
                            if (err) debugger;
                            
                            parseLcov(data, function(err, result){
                                // TODO clear coverage of all sub-nodes
                                // TODO remove coveragePath
                                node.coverage = result;
                                node.coveragePath = coveragePath;
                                
                                done();
                            });
                        });
                    }
                    else done();
                    
                    function done(){
                        // Cleanup for before/after failure
                        allTests.forEach(function(n){ 
                            if (n.status != "loaded")
                                progress.end(n);
                        });
                        
                        callback(null, node);
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
            
            stack.message = message.join(" ");
        
            return stack;
        }
        
        function coverage(){
            
        }
        
        function stop(){
            if (currentPty)
                currentPty.kill();
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
            run: run,
            
            /**
             * 
             */
            stop: stop,
            
            /**
             * 
             */
            coverage: coverage
        });
        
        register(null, {
            "test.mocha": plugin
        });
    }
});