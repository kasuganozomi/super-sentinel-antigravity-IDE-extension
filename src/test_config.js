const vscode = require('vscode');

function activate(context) {
    let disposable = vscode.commands.registerCommand('super-sentinel.testConfig', function () {
        const config = vscode.workspace.getConfiguration('antigravity');
        vscode.window.showInformationMessage('Config keys: ' + Object.keys(config).join(', '));
        console.log(config);
    });
    context.subscriptions.push(disposable);
}
exports.activate = activate;
