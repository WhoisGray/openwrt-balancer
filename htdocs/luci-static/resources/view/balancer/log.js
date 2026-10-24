'use strict';
'require view';
'require poll';
'require rpc';

var callLog = rpc.declare({
	object: 'luci.balancer',
	method: 'log',
	expect: { lines: [] }
});

function ensureCss() {
	if (document.getElementById('bl-css'))
		return;
	var link = document.createElement('link');
	link.id = 'bl-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/balancer/balancer.css') + '?v=1.0.0';
	document.head.appendChild(link);
}

return view.extend({
	render: function() {
		ensureCss();
		var pre = E('pre', {}, _('Waiting for log entries…'));
		var root = E('div', { 'class': 'bl-app' }, [
			E('div', { 'class': 'bl-top' }, [
				E('div', {}, [
					E('h2', { 'class': 'bl-title' }, _('Log')),
					E('p', { 'class': 'bl-sub' }, _('What Balancer changed. Passwords are left out.'))
				])
			]),
			E('div', { 'class': 'bl-log' }, [ pre ])
		]);

		var paint = function(lines) {
			if (!lines || !lines.length) {
				pre.textContent = _('No log entries yet. They appear after you add a source or reset.');
				return;
			}
			pre.textContent = lines.join('\n');
		};

		poll.add(function() {
			return callLog().then(function(res) {
				paint(res && res.lines);
			}).catch(function(err) {
				pre.textContent = (err && err.message) || _('Could not read the log.');
			});
		}, 5);

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
