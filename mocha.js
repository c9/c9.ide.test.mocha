define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "ui", "layout", "commands"
    ];
    main.provides = ["test.mocha"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var ui = imports.ui;
        var commands = imports.commands;
        var layout = imports.layout;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit = plugin.getEmitter();
        
        var coverage = {};
        
        function load() {
            // Potentially listen to the save event and run specific tests
        }
        
        /***** Methods *****/
        
        function init(root){
            root.label = "Mocha Javascript Tests";
            
            /* 
                Set hooks to update list
                - Strategies:
                    - Periodically
                    - Based on watcher events
                    - Based on opening the test panel
                    - Refresh button
                
                Do initial populate
            */
            
            // all.tree.refresh();
        }
        
        function populate(node){
            
        }
        
        function run(node, callback){
            
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
             * @property coverage
             */
            // get coverage(){ return ... },
            
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
            run: run
        });
        
        register(null, {
            "test.mocha": plugin
        });
    }
});