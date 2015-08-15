define(function(require, exports, module) {
    main.consumes = [
        "TestRunner", "settings", "preferences", "proc", "util", "fs", "watcher"
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
        var watcher = imports.watcher;
        
        var dirname = require("path").dirname;
        
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
        
        function load() {
            // Potentially listen to the save event and run specific tests
            
            // prefs...
            
        }
        
        /***** Methods *****/
        
        function fetch(callback) {
            var cmd, args;
            
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
            
            proc.execFile(cmd, {
                args: args
            }, function(err, stdout, stderr) {
                if (err) return callback(err);
                
                if (!SCRIPT) {
                    var filter = new RegExp("^(?:"
                        + EXCLUDE_LIST.forEach(util.escapeRegExp).join("|") 
                        + ")(?:\n|$)", "gm");
                    
                    stdout = stdout.replace(stdout, filter);
                }
                
                lastList = stdout;
                
                callback(null, stdout);
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
                if (!isUpdating) return fsUpdate(null, 10000);
                
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
                            type: "file"
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
        }
        
        var bdd = [
            { regex: /(?:^|\n)\s*describe\s*(?:\.only)?\s*\(\s*['"](.*)$/, kind: "describe" },
            { regex: /(?:^|\n)\s*it\s*(?:\.only)\s*\(\s*['"](.*)$/, kind: "it" }
            // { regex: /(?:^|\n)\s*before\s*\($/, kind: "before" },
            // { regex: /(?:^|\n)\s*after\s*\($/, kind: "beforeEach" },
            // { regex: /(?:^|\n)\s*beforeEach\s*\($/, kind: "beforeEach" },
            // { regex: /(?:^|\n)\s*afterEach\s*\($/, kind: "afterEach" }
        ];
        function parseBDD(node, contents){
            // TODO: update
            if (!parent.items) parent.items = [];
            
            var depth = 0, trail = [node];
            contents.split("\n").forEach(function(line){
                for (var i = 0; i < bdd.length; i++) {
                    if (line.match(bdd[i])) {
                        var n = {
                            label: RegExp.$1 || bdd[i].kind, 
                            kind: bdd[i].kind,
                            status: "loaded"
                        };
                        
                        if (i == 1) trail[trail.length - 1].items.push(n);
                        else {
                            n.depth = depth;
                            
                            // Deeper, it's a child
                            if (depth > trail[trail.length - 1].depth) {
                                trail.push(n);
                            }
                            // Same depth it's a sibling
                            else if (depth == trail[trail.length - 1].depth) {
                                trail.pop();
                            }
                            // Smaller depth - search for it
                            else {
                                while (trail.length && trail[trail.length - 1].depth > depth)
                                    trail.pop();
                            }
                            
                            trail[trail.length - 1].items.push(n);
                        }
                    }
                    
                    depth += (line.match(/\{/g) || []).length;
                    depth -= (line.match(/\}/g) || []).length;
                }
            });
            
            return node;
        }
        
        function populate(node, callback) {
            fs.readFile(node.label, function(err, contents){
                if (err) return callback(err);
                
                callback(null, parseBDD(node, contents));
            });
        }
        
        function getTestNode(node, id, name){
            var found = (function recur(items){
                for (var i = 0; i < items.length; i++) {
                    if (items[i].label == name)
                        return items[i];
                    
                    if (items.items) {
                        var found = recur(items.items);
                        if (found) return found;
                    }
                }
            })([node]);
            
            // TODO optional fallback to using id
            
            return found;
        }
        
        function run(node, log, callback) {
            var fileNode, path, passed = true, args = ["--reporter", "tap"];
            
            if (node.type == "file") {
                fileNode = node;
            }
            else {
                fileNode = node._parent;
                
                // if (node.type == "set" || node.type == "test") {
                args.push("--grep", "^" + util.escapeRegExp(node.label) + "$");
            }
            
            // TODO: --debug --debug-brk
            args.push(fileNode.label);
            
            proc.pty("mocha", {
                args: args,
                cwd: dirname(path)
            }, function(err, pty){
                if (err) return callback(err);
                
                var output = "", testCount, bailed, results = {}, totalTests = 0;
                pty.on("data", function(c){
                    // Log to the raw viewer
                    log(c);
                    
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
                        var pass = RegExp.$1 == "ok";
                        var id = RegExp.$2;
                        var name = RegExp.$3;
                        
                        // Set file passed state
                        if (!pass) passed = false;
                        
                        // Update Node
                        var resultNode = getTestNode(fileNode, id, name);
                        
                        // Set Results
                        resultNode.output = output;
                        resultNode.passed = pass ? 1 : 0;
                        // resultNode.assertion = {
                        //     line: 0,
                        //     col: 10,
                        //     message: ""
                        // };
                        
                        // Reset output
                        output = "";
                        
                        // Count the tests
                        totalTests++;
                    }
                    
                    // Output
                    else {
                        output += c;
                    }
                });
                pty.on("exit", function(c){
                    node.passed = passed;
                    
                    // totalTests == testCount
                    
                    callback(null, node);
                });
            });
        }
        
        function coverage(){
            
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
            coverage: coverage
        });
        
        register(null, {
            "test.mocha": plugin
        });
    }
});