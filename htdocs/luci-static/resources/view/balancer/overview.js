'use strict';
'require view';
'require poll';
'require rpc';
'require ui';

var callStatus = rpc.declare({
	object: 'luci.balancer',
	method: 'status',
	timeout: 20
});

var callSave = rpc.declare({
	object: 'luci.balancer',
	method: 'save_source',
	params: [ 'payload' ],
	timeout: 180
});

var callRemove = rpc.declare({
	object: 'luci.balancer',
	method: 'remove_source',
	params: [ 'id' ],
	timeout: 180
});

var callWeight = rpc.declare({
	object: 'luci.balancer',
	method: 'set_weight',
	params: [ 'id', 'weight' ],
	timeout: 60
});

var callEnable = rpc.declare({
	object: 'luci.balancer',
	method: 'enable_source',
	params: [ 'id', 'enabled' ],
	timeout: 180
});

var callApply = rpc.declare({
	object: 'luci.balancer',
	method: 'apply',
	timeout: 180
});

var callReset = rpc.declare({
	object: 'luci.balancer',
	method: 'reset',
	params: [ 'forget' ],
	timeout: 180
});

var callScan = rpc.declare({
	object: 'luci.balancer',
	method: 'scan',
	params: [ 'band' ],
	timeout: 90
});

var state = null;
var modalOpen = false;
var dragging = false;
var weights = {};
var weightTimer = {};
var mainNode = null;
var banner = '';

function ensureCss() {
	if (document.getElementById('bl-css'))
		return;
	var link = document.createElement('link');
	link.id = 'bl-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/balancer/balancer.css') + '?v=1.0.0';
	document.head.appendChild(link);
}

function bandLabel(band) {
	switch (band) {
	case '2g': return _('2.4 GHz');
	case '5g': return _('5 GHz');
	case '6g': return _('6 GHz');
	default: return _('Any band');
	}
}

function encLabel(enc) {
	switch (enc) {
	case 'none': return _('Open');
	case 'psk': return _('WPA');
	case 'psk2': return _('WPA2');
	case 'psk-mixed': return _('WPA/WPA2');
	case 'sae': return _('WPA3');
	case 'sae-mixed': return _('WPA2/WPA3');
	default: return enc || _('WPA2');
	}
}

function kindLine(s) {
	if (s.kind === 'wifi')
		return _('Wi-Fi') + ' · ' + (s.ssid || s.label || '');
	if (s.kind === 'device')
		return _('Port') + ' · ' + (s.device || '');
	return _('Interface') + ' · ' + (s.network || '');
}

function fmtUp(sec) {
	sec = parseInt(sec, 10) || 0;
	if (sec < 90)
		return sec + 's';
	var m = Math.floor(sec / 60);
	if (m < 90)
		return m + 'm';
	var h = Math.floor(m / 60);
	return h + 'h ' + (m % 60) + 'm';
}

function showError(message) {
	banner = message || '';
	if (mainNode && !modalOpen)
		paint();
}

function closeModal() {
	modalOpen = false;
	ui.hideModal();
}

function openModal(title, body) {
	modalOpen = true;
	ui.showModal(title, E('div', { 'class': 'bl-modal' }, body));
}

function field(label, control) {
	return E('div', { 'class': 'bl-field' }, [
		E('label', {}, label),
		control
	]);
}

function selectEl(options, value) {
	var node = E('select', { 'class': 'bl-select' });
	options.forEach(function(opt) {
		node.appendChild(E('option', { value: opt[0], selected: opt[0] === value ? '' : null }, opt[1]));
	});
	node.value = value;
	return node;
}

function previewWeights() {
	if (!state || !state.sources)
		return;
	var sum = 0;
	state.sources.forEach(function(s) {
		var w = weights[s.id] != null ? weights[s.id] : (s.weight || 1);
		if (s.enabled)
			sum += w;
	});
	if (!sum)
		sum = 1;
	state.sources.forEach(function(s) {
		var card = document.getElementById('bl-card-' + s.id);
		if (!card)
			return;
		var w = weights[s.id] != null ? weights[s.id] : (s.weight || 1);
		var pct = s.enabled ? Math.round(w * 100 / sum) : 0;
		var bar = card.querySelector('.bl-bar > span');
		var lab = card.querySelector('.bl-pct');
		var num = card.querySelector('.bl-wnum');
		if (bar)
			bar.style.width = pct + '%';
		if (lab)
			lab.textContent = pct + '%';
		if (num)
			num.textContent = String(w);
	});
}

function commitWeight(id, value) {
	dragging = true;
	window.clearTimeout(weightTimer[id]);
	weightTimer[id] = window.setTimeout(function() {
		callWeight(id, value).then(function(res) {
			dragging = false;
			if (!res || res.ok === false)
				showError((res && res.error) || _('Could not update the weight.'));
			return refresh();
		}).catch(function(err) {
			dragging = false;
			showError((err && err.message) || _('Could not update the weight.'));
		});
	}, 450);
}

function onToggle(source) {
	var next = !source.enabled;
	var run = function() {
		callEnable(source.id, next).then(function(res) {
			if (!res || res.ok === false) {
				showError((res && (res.error || res.warning)) || _('Could not update that source.'));
			} else if (res.warning) {
				showError(res.warning);
			}
			return refresh();
		}).catch(function(err) {
			showError((err && err.message) || _('Could not update that source.'));
		});
	};
	if (state && state.applied && source.kind === 'wifi') {
		openModal(_('Reload Wi-Fi'), [
			E('p', {}, _('Changing this Wi-Fi source reloads Wi-Fi. Connections drop for a few seconds, then come back.')),
			E('div', { 'class': 'bl-modal-actions' }, [
				E('button', { 'class': 'bl-btn', 'type': 'button', 'click': closeModal }, _('Cancel')),
				E('button', { 'class': 'bl-btn bl-btn-primary', 'type': 'button', 'click': function() { closeModal(); run(); } }, _('Continue'))
			])
		]);
		return;
	}
	run();
}

function onRemove(source) {
	openModal(_('Remove source'), [
		E('p', {}, _('Remove this source from Balancer?') + ' ' + (source.label || source.id)),
		E('div', { 'class': 'bl-modal-actions' }, [
			E('button', { 'class': 'bl-btn', 'type': 'button', 'click': closeModal }, _('Cancel')),
			E('button', {
				'class': 'bl-btn bl-btn-danger',
				'type': 'button',
				'click': function(ev) {
					var btn = ev.target;
					btn.disabled = true;
					btn.textContent = _('Removing…');
					callRemove(source.id).then(function(res) {
						closeModal();
						if (!res || res.ok === false)
							showError((res && (res.error || res.warning)) || _('Could not remove that source.'));
						else if (res.warning)
							showError(res.warning);
						return refresh();
					}).catch(function(err) {
						closeModal();
						showError((err && err.message) || _('Could not remove that source.'));
					});
				}
			}, _('Remove'))
		])
	]);
}

function sourceCard(s) {
	var pct = s.percent || 0;
	var online = !!s.online;
	var range = E('input', {
		'class': 'bl-range',
		'type': 'range',
		'min': '1',
		'max': '100',
		'value': String(s.weight || 1),
		'aria-label': _('Weight')
	});
	range.addEventListener('input', function() {
		dragging = true;
		weights[s.id] = parseInt(range.value, 10) || 1;
		previewWeights();
	});
	range.addEventListener('change', function() {
		var value = parseInt(range.value, 10) || 1;
		weights[s.id] = value;
		commitWeight(s.id, value);
	});

	var actions = [
		E('button', { 'class': 'bl-link danger', 'type': 'button', 'click': function() { onRemove(s); } }, _('Remove'))
	];
	if (s.kind === 'wifi')
		actions.unshift(E('button', { 'class': 'bl-link', 'type': 'button', 'click': function() { openWifi(s); } }, _('Edit')));

	var detail = kindLine(s);
	if (online && s.uptime)
		detail += ' · ' + fmtUp(s.uptime);
	else if (!online && s.track && s.track !== 'unknown')
		detail += ' · ' + s.track;

	return E('article', { 'class': 'bl-card' + (s.enabled ? '' : ' is-off'), 'id': 'bl-card-' + s.id }, [
		E('div', { 'class': 'bl-card-top' }, [
			E('div', {}, [
				E('h3', { 'class': 'bl-name' }, s.label || s.id),
				E('p', { 'class': 'bl-meta' }, detail)
			]),
			E('span', { 'class': 'bl-badge ' + (online ? 'is-on' : 'is-off') }, [
				E('i', { 'class': 'bl-dot' }),
				online ? _('Online') : _('Offline')
			])
		]),
		E('div', { 'class': 'bl-weight' }, [
			E('div', { 'class': 'bl-weight-top' }, [
				E('span', { 'class': 'bl-pct' }, pct + '%'),
				E('span', {}, [ _('Weight '), E('span', { 'class': 'bl-wnum' }, String(s.weight || 1)) ])
			]),
			range,
			E('div', { 'class': 'bl-bar' }, [ E('span', { 'style': 'width:' + pct + '%' }) ])
		]),
		E('div', { 'class': 'bl-card-actions' }, [
			E('div', {}, actions),
			E('button', {
				'class': 'bl-switch' + (s.enabled ? ' is-on' : ''),
				'type': 'button',
				'role': 'switch',
				'aria-checked': s.enabled ? 'true' : 'false',
				'aria-label': _('Enabled'),
				'click': function() { onToggle(s); }
			}, [ E('i') ])
		])
	]);
}

function encOptions(selected) {
	return selectEl([
		[ 'psk2', _('WPA2') ],
		[ 'sae', _('WPA3') ],
		[ 'sae-mixed', _('WPA2/WPA3') ],
		[ 'psk-mixed', _('WPA/WPA2') ],
		[ 'psk', _('WPA') ],
		[ 'none', _('Open') ]
	], selected || 'psk2');
}

function bandOptions(selected) {
	var opts = [ [ 'any', _('Any band') ], [ '2g', _('2.4 GHz') ], [ '5g', _('5 GHz') ], [ '6g', _('6 GHz') ] ];
	var radios = (state && state.radios) || [];
	if (radios.length) {
		opts = [ [ 'any', _('Any band') ] ];
		var seen = {};
		radios.forEach(function(r) {
			if (!r.disabled && r.band && !seen[r.band]) {
				seen[r.band] = true;
				opts.push([ r.band, bandLabel(r.band) ]);
			}
		});
	}
	return selectEl(opts, selected || 'any');
}

function submitSource(payload, button) {
	button.disabled = true;
	var previous = button.textContent;
	button.textContent = _('Applying…');
	callSave(JSON.stringify(payload)).then(function(res) {
		if (!res || res.ok === false) {
			button.disabled = false;
			button.textContent = previous;
			var box = document.querySelector('.bl-modal .bl-warn');
			var msg = (res && (res.error || res.warning)) || _('Could not save that source.');
			if (box)
				box.textContent = msg;
			else
				showError(msg);
			return;
		}
		closeModal();
		if (res.warning)
			showError(res.warning);
		return refresh();
	}).catch(function(err) {
		button.disabled = false;
		button.textContent = previous;
		showError((err && err.message) || _('Could not save that source.'));
	});
}

function openWifi(existing) {
	existing = existing || {};
	var ssid = E('input', { 'class': 'bl-input', 'type': 'text', 'value': existing.ssid || '', 'placeholder': _('Network name'), 'maxlength': '32' });
	var key = E('input', { 'class': 'bl-input', 'type': 'password', 'placeholder': existing.has_key ? _('Leave blank to keep the current password') : _('Password'), 'autocomplete': 'off' });
	var enc = encOptions(existing.encryption || 'psk2');
	var band = bandOptions(existing.band || 'any');
	var weight = E('input', { 'class': 'bl-range', 'type': 'range', 'min': '1', 'max': '100', 'value': String(existing.weight || 10) });
	var weightNum = E('span', { 'class': 'bl-wnum' }, String(existing.weight || 10));
	weight.addEventListener('input', function() { weightNum.textContent = weight.value; });
	var hidden = E('input', { 'type': 'checkbox' });
	if (existing.hidden)
		hidden.checked = true;
	var warn = E('p', { 'class': 'bl-warn' }, '');
	var results = E('div', { 'class': 'bl-scan-list', 'style': 'display:none' });

	var scanBtn = E('button', {
		'class': 'bl-btn',
		'type': 'button',
		'click': function() {
			scanBtn.disabled = true;
			scanBtn.textContent = _('Scanning…');
			warn.textContent = _('Scanning pauses that radio for a moment.');
			callScan(band.value || 'any').then(function(res) {
				scanBtn.disabled = false;
				scanBtn.textContent = _('Scan');
				results.innerHTML = '';
				var cells = (res && res.cells) || [];
				if (!res || res.ok === false) {
					warn.textContent = (res && res.error) || _('Scan failed.');
					return;
				}
				if (!cells.length) {
					warn.textContent = _('No networks found.');
					results.style.display = 'none';
					return;
				}
				warn.textContent = '';
				results.style.display = '';
				cells.forEach(function(cell) {
					results.appendChild(E('button', {
						'class': 'bl-scan-item',
						'type': 'button',
						'click': function() {
							ssid.value = cell.ssid || '';
							if (cell.encryption)
								enc.value = cell.encryption;
							if (cell.band)
								band.value = cell.band;
							results.style.display = 'none';
						}
					}, (cell.ssid || '') + ' · ' + bandLabel(cell.band) + ' · ' + (cell.signal || '') + ' dBm'));
				});
			}).catch(function(err) {
				scanBtn.disabled = false;
				scanBtn.textContent = _('Scan');
				warn.textContent = (err && err.message) || _('Scan failed.');
			});
		}
	}, _('Scan'));

	var saveBtn = E('button', {
		'class': 'bl-btn bl-btn-primary',
		'type': 'button',
		'click': function() {
			warn.textContent = '';
			if (!ssid.value.trim()) {
				warn.textContent = _('Enter the Wi-Fi name.');
				return;
			}
			submitSource({
				id: existing.id || '',
				kind: 'wifi',
				label: ssid.value.trim(),
				ssid: ssid.value.trim(),
				key: key.value,
				encryption: enc.value,
				band: band.value,
				weight: parseInt(weight.value, 10) || 10,
				hidden: hidden.checked,
				enabled: existing.id ? existing.enabled !== false : true,
				apply: true
			}, saveBtn);
		}
	}, existing.id ? _('Save') : _('Add Wi-Fi'));

	openModal(existing.id ? _('Edit Wi-Fi') : _('Add Wi-Fi'), [
		E('p', { 'class': 'bl-meta' }, _('Applying a Wi-Fi source reloads Wi-Fi. Connections drop for a few seconds, then come back.')),
		warn,
		field(_('Network name'), ssid),
		E('div', { 'class': 'bl-row' }, [
			field(_('Password'), key),
			field(_('Security'), enc)
		]),
		E('div', { 'class': 'bl-row' }, [
			field(_('Band'), band),
			E('div', { 'class': 'bl-field' }, [
				E('label', {}, _('Weight ') , weightNum),
				weight
			])
		]),
		E('label', { 'class': 'bl-check' }, [
			hidden,
			E('span', {}, _('Hidden network'))
		]),
		E('div', { 'class': 'bl-modal-actions' }, [
			scanBtn,
			E('button', { 'class': 'bl-btn', 'type': 'button', 'click': closeModal }, _('Cancel')),
			saveBtn
		]),
		results
	]);
}

function openPort() {
	var candidates = (state && state.candidates) || [];
	var choices = [];
	candidates.forEach(function(c) {
		if (c.name === 'lo' || c.name === 'br-lan')
			return;
		if (c.group === 'network' && c.name !== 'lan')
			choices.push(c);
	});
	candidates.forEach(function(c) {
		if (c.name === 'lo' || c.name === 'br-lan')
			return;
		if (c.group === 'port' && c.warning !== 'cpu' && c.warning !== 'lan' && c.warning !== 'bridge-port')
			choices.push(c);
	});
	candidates.forEach(function(c) {
		if (c.name === 'lo' || c.name === 'br-lan')
			return;
		if ((c.group === 'network' && c.name === 'lan') || (c.group === 'port' && (c.warning === 'bridge-port' || c.warning === 'lan' || c.warning === 'cpu'))) {
			if (choices.indexOf(c) === -1)
				choices.push(c);
		}
	});

	var select = E('select', { 'class': 'bl-select' });
	if (!choices.length)
		select.appendChild(E('option', { value: '' }, _('No ports found')));
	choices.forEach(function(c) {
		var prefix = c.group === 'network' ? _('Interface') : _('Port');
		var extra = c.warning ? ' · ' + c.warning : '';
		select.appendChild(E('option', { value: c.group + ':' + c.name }, prefix + ' · ' + c.name + extra));
	});

	var weight = E('input', { 'class': 'bl-range', 'type': 'range', 'min': '1', 'max': '100', 'value': '10' });
	var weightNum = E('span', { 'class': 'bl-wnum' }, '10');
	weight.addEventListener('input', function() { weightNum.textContent = weight.value; });
	var warn = E('p', { 'class': 'bl-warn' }, '');
	var forceWrap = E('label', { 'class': 'bl-check', 'style': 'display:none' }, [
		E('input', { 'type': 'checkbox', 'class': 'bl-force' }),
		E('span', {}, _('I understand this can disconnect devices on that port.'))
	]);

	function selected() {
		var raw = select.value || '';
		var cut = raw.indexOf(':');
		if (cut < 0)
			return null;
		var group = raw.slice(0, cut);
		var name = raw.slice(cut + 1);
		for (var i = 0; i < choices.length; i++) {
			if (choices[i].group === group && choices[i].name === name)
				return choices[i];
		}
		return null;
	}

	function refreshWarn() {
		var c = selected();
		var danger = c && (c.warning === 'lan' || c.warning === 'bridge-port' || c.name === 'lan');
		forceWrap.style.display = danger ? '' : 'none';
		if (c && c.warning === 'cpu')
			warn.textContent = _('This looks like the switch CPU port. Prefer the WAN port or a USB Ethernet adapter.');
		else
			warn.textContent = '';
	}
	select.addEventListener('change', refreshWarn);
	refreshWarn();

	var saveBtn = E('button', {
		'class': 'bl-btn bl-btn-primary',
		'type': 'button',
		'click': function() {
			var c = selected();
			if (!c) {
				warn.textContent = _('Pick an interface or a port.');
				return;
			}
			var danger = c.warning === 'lan' || c.warning === 'bridge-port' || c.name === 'lan';
			var force = forceWrap.querySelector('.bl-force');
			if (danger && !(force && force.checked)) {
				warn.textContent = _('Confirm the LAN warning before using this port.');
				return;
			}
			var payload = {
				kind: c.group === 'network' ? 'existing' : 'device',
				label: c.name,
				weight: parseInt(weight.value, 10) || 10,
				enabled: true,
				force_lan: !!(force && force.checked),
				apply: true
			};
			if (payload.kind === 'existing')
				payload.network = c.name;
			else
				payload.device = c.name;
			submitSource(payload, saveBtn);
		}
	}, _('Add interface'));

	openModal(_('Add interface'), [
		E('p', { 'class': 'bl-meta' }, _('Use an existing WAN, or a free port. Applying reloads the network.')),
		warn,
		field(_('Source'), select),
		E('div', { 'class': 'bl-field' }, [
			E('label', {}, _('Weight ') , weightNum),
			weight
		]),
		forceWrap,
		E('div', { 'class': 'bl-modal-actions' }, [
			E('button', { 'class': 'bl-btn', 'type': 'button', 'click': closeModal }, _('Cancel')),
			saveBtn
		])
	]);
}

function openReset() {
	var forget = E('input', { 'type': 'checkbox' });
	var warn = E('p', { 'class': 'bl-warn' }, '');
	var btn = E('button', {
		'class': 'bl-btn bl-btn-danger',
		'type': 'button',
		'click': function() {
			btn.disabled = true;
			btn.textContent = _('Restoring…');
			callReset(forget.checked).then(function(res) {
				closeModal();
				if (!res || res.ok === false)
					showError((res && (res.error || res.warning)) || _('Reset did not finish.'));
				else if (res.warning)
					showError(res.warning);
				return refresh();
			}).catch(function(err) {
				closeModal();
				showError((err && err.message) || _('Reset did not finish.'));
			});
		}
	}, _('Restore original WAN'));

	openModal(_('Reset to Default'), [
		E('p', {}, _('This restores the original mwan3 balanced policy, puts LAN ports back on the bridge, and removes interfaces Balancer created.')),
		E('label', { 'class': 'bl-check' }, [
			forget,
			E('span', {}, _('Also forget saved sources'))
		]),
		warn,
		E('div', { 'class': 'bl-modal-actions' }, [
			E('button', { 'class': 'bl-btn', 'type': 'button', 'click': closeModal }, _('Cancel')),
			btn
		])
	]);
}

function liveStrip() {
	if (!state || state.applied)
		return E('div');
	var live = state.live || [];
	if (!live.length)
		return E('div');
	return E('div', {}, [
		E('p', { 'class': 'bl-kicker' }, _('Currently balanced')),
		E('div', { 'class': 'bl-chips' }, live.map(function(item) {
			return E('span', { 'class': 'bl-chip' }, [
				E('i', { 'class': 'bl-dot', 'style': item.online ? 'background:#34c759' : 'background:#ff3b30' }),
				(item.network || item.member || '') + ' · ' + (item.weight || 1)
			]);
		}))
	]);
}

function paint() {
	if (!mainNode)
		return;
	var sources = (state && state.sources) || [];
	weights = {};
	sources.forEach(function(s) { weights[s.id] = s.weight || 1; });

	var notes = [];
	if (banner)
		notes.push(E('div', { 'class': 'bl-alert' }, banner));
	if (state && state.mwan3 === false)
		notes.push(E('div', { 'class': 'bl-alert' }, _('Install the mwan3 package, then reload this page.')));
	if (state && state.applied && state.base_included === false)
		notes.push(E('div', { 'class': 'bl-note' }, _('The primary WAN is not in this balance. Add it if the other sources should have a fallback.')));
	if (state && !state.applied && sources.length)
		notes.push(E('div', { 'class': 'bl-note' }, [
			_('These sources are saved. Apply them to start balancing. '),
			E('button', {
				'class': 'bl-link',
				'type': 'button',
				'click': function(ev) {
					ev.target.disabled = true;
					callApply().then(function(res) {
						if (!res || res.ok === false)
							showError((res && (res.error || res.warning)) || _('Could not apply.'));
						else if (res.warning)
							showError(res.warning);
						return refresh();
					}).catch(function(err) {
						showError((err && err.message) || _('Could not apply.'));
					});
				}
			}, _('Apply'))
		]));

	var cards;
	if (!sources.length)
		cards = E('div', { 'class': 'bl-card bl-empty' }, _('No sources yet. Add a Wi-Fi network or a physical port.'));
	else
		cards = E('div', { 'class': 'bl-grid' }, sources.map(sourceCard));

	var body = [ liveStrip() ].concat(notes).concat([
		E('p', { 'class': 'bl-kicker' }, _('Sources')),
		cards,
		E('p', { 'class': 'bl-foot' }, 'Balancer ' + ((state && state.version) || '') + ' · mwan3')
	]);

	while (mainNode.firstChild)
		mainNode.removeChild(mainNode.firstChild);
	body.forEach(function(node) {
		if (node)
			mainNode.appendChild(node);
	});
}

function refresh() {
	if (modalOpen || dragging)
		return Promise.resolve(state);
	return callStatus().then(function(res) {
		if (!res || res.ok === false) {
			showError((res && res.error) || _('Could not read Balancer status.'));
			return res;
		}
		state = res;
		paint();
		return res;
	}).catch(function(err) {
		showError((err && err.message) || _('Could not read Balancer status.'));
	});
}

return view.extend({
	render: function() {
		ensureCss();
		mainNode = E('div', { 'id': 'bl-main' });
		var root = E('div', { 'class': 'bl-app' }, [
			E('div', { 'class': 'bl-top' }, [
				E('div', {}, [
					E('h2', { 'class': 'bl-title' }, _('Balancer')),
					E('p', { 'class': 'bl-sub' }, _('Share traffic across every internet source. Each weight is a share of the whole.')),
					E('div', { 'class': 'bl-pill', 'id': 'bl-pill' }, _('Loading…'))
				]),
				E('div', { 'class': 'bl-actions' }, [
					E('button', { 'class': 'bl-btn bl-btn-primary', 'type': 'button', 'click': function() { openWifi(); } }, _('Add Wi-Fi')),
					E('button', { 'class': 'bl-btn bl-btn-ghost', 'type': 'button', 'click': openPort }, _('Add interface')),
					E('button', { 'class': 'bl-btn bl-btn-danger', 'type': 'button', 'click': openReset }, _('Reset to Default'))
				])
			]),
			mainNode
		]);

		var updatePill = function() {
			var pill = document.getElementById('bl-pill');
			if (!pill || !state)
				return;
			pill.className = 'bl-pill' + (state.applied ? ' is-on' : '');
			pill.textContent = state.applied ? _('Balancing') : _('Not applied');
		};

		poll.add(function() {
			return refresh().then(updatePill);
		}, 6);
		refresh().then(updatePill);

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
