// ==========================================================================
// Immich Filter Playground — Client Application
// ==========================================================================

const state = {
	immichUrl: '',
	externalUrl: '',
	accounts: [],
	accountDetails: [],
	selectedUser: '',
	searchMode: 'random',
	orderByField: 'localDateTime',
	orderByDirection: 'desc',
	sampleSize: 24,
	includeVideos: true,
	includeArchived: false,
	activeCodeTab: 'filter',
	profiles: [],
	activeProfileId: '',
	metadata: {
		people: [],
		albums: [],
		tags: [],
		countries: [],
		states: [],
		cities: [],
		cameras: [],
		makes: [],
		lenses: []
	},
	lastAssets: [],
	lastRequestBodyJson: '{}',
	lightboxIndex: -1,
	defaults: {
		sampleSize: 24,
		searchMode: 'random',
		includeVideos: true,
		includeArchived: false
	},
	ruleTree: {
		id: 'root',
		type: 'group',
		combiner: 'AND',
		children: []
	}
};

let searchDebounceTimer = null;
let activeSearchController = null;
let searchSequenceId = 0;
const PROFILE_HISTORY_LIMIT = 50;
let profileHistoryApplying = false;
const savedProfileSnapshots = new Map();
let resolveUnsavedProfilePrompt = null;
let saveProfileAsCopy = false;
const customHistory = { entries: [], index: -1 };

// ==========================================================================
// Utilities
// ==========================================================================

function generateNodeId(prefix) {
	return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(str) {
	if (str === null || str === undefined) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeJsString(str) {
	if (str === null || str === undefined) return '';
	return String(str)
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/"/g, '\\"');
}

// ==========================================================================
// Field & Operator Definitions
// ==========================================================================

const FIELD_DEFINITIONS = [
	{ value: 'people', label: '👥 People', type: 'multi-id' },
	{ value: 'albums', label: '📁 Albums', type: 'multi-id' },
	{ value: 'tags', label: '🏷️ Tags', type: 'multi-id' },
	{ value: 'country', label: '🌍 Country', type: 'multi-str' },
	{ value: 'state', label: '🗺️ State / Region', type: 'multi-str' },
	{ value: 'city', label: '🏙️ City', type: 'multi-str' },
	{ value: 'camera', label: '📷 Camera Model', type: 'multi-str' },
	{ value: 'make', label: '🏭 Camera Make', type: 'multi-str' },
	{ value: 'lens', label: '🔭 Lens Model', type: 'multi-str' },
	{ value: 'favorite', label: '⭐ Favorite', type: 'bool' },
	{ value: 'media_type', label: '🎬 Media Type', type: 'enum' },
	{ value: 'visibility', label: '👁️ Visibility', type: 'enum' },
	{ value: 'rating', label: '⭐ Rating', type: 'rating' },
	{ value: 'date', label: '📅 Date Taken', type: 'date' },
	{ value: 'has_people', label: '👤 Has People', type: 'bool' },
	{ value: 'has_albums', label: '📁 Has Albums', type: 'bool' },
	{ value: 'has_tags', label: '🏷️ Has Tags', type: 'bool' },
	{ value: 'description', label: '📝 Description', type: 'pattern' },
	{ value: 'filename', label: '📄 Filename', type: 'pattern' },
	{ value: 'ocr', label: '🔤 OCR Text', type: 'ocr' }
];

function getDefaultOperatorForField(field) {
	switch (field) {
		case 'people':
			return 'all';
		case 'albums':
		case 'tags':
			return 'any';
		case 'country':
		case 'state':
		case 'city':
		case 'camera':
		case 'make':
		case 'lens':
			return 'in';
		case 'favorite':
		case 'has_people':
		case 'has_albums':
		case 'has_tags':
			return 'true';
		case 'media_type':
			return 'IMAGE';
		case 'visibility':
			return 'timeline';
		case 'rating':
			return 'gte';
		case 'date':
			return 'after';
		case 'description':
		case 'filename':
			return 'like';
		case 'ocr':
			return 'matches';
		default:
			return 'eq';
	}
}

function getDefaultValueForField(field) {
	if (['people', 'albums', 'tags', 'country', 'state', 'city', 'camera', 'make', 'lens'].includes(field)) {
		return [];
	}
	if (['favorite', 'has_people', 'has_albums', 'has_tags'].includes(field)) {
		return true;
	}
	if (field === 'media_type') return 'IMAGE';
	if (field === 'visibility') return 'timeline';
	if (field === 'rating') return 3;
	return '';
}

function getFieldOptionsList(field) {
	const m = state.metadata || {};
	if (field === 'people') return (m.people || []).map(p => ({ value: p.id, label: p.label }));
	if (field === 'albums') return (m.albums || []).map(a => ({ value: a.id, label: a.count ? `${a.label} (${a.count})` : a.label }));
	if (field === 'tags') return (m.tags || []).map(t => ({ value: t.id, label: t.label }));
	if (field === 'country') return (m.countries || []).map(v => ({ value: v, label: v }));
	if (field === 'state') return (m.states || []).map(v => ({ value: v, label: v }));
	if (field === 'city') return (m.cities || []).map(v => ({ value: v, label: v }));
	if (field === 'camera') return (m.cameras || []).map(v => ({ value: v, label: v }));
	if (field === 'make') return (m.makes || []).map(v => ({ value: v, label: v }));
	if (field === 'lens') return (m.lenses || []).map(v => ({ value: v, label: v }));
	return [];
}

// ==========================================================================
// Tree Manipulation
// ==========================================================================

function findNode(group, id) {
	if (!group) return null;
	if (group.id === id) return group;
	if (!group.children) return null;
	for (const child of group.children) {
		if (child.id === id) return child;
		if (child.type === 'group') {
			const res = findNode(child, id);
			if (res) return res;
		}
	}
	return null;
}

function findGroupAndIndex(group, id) {
	if (!group || !group.children) return null;
	for (let i = 0; i < group.children.length; i++) {
		if (group.children[i].id === id) {
			return { parent: group, index: i, node: group.children[i] };
		}
		if (group.children[i].type === 'group') {
			const res = findGroupAndIndex(group.children[i], id);
			if (res) return res;
		}
	}
	return null;
}

window.rtAddRule = function(groupId, defaultField) {
	const group = findNode(state.ruleTree, groupId);
	if (!group || group.type !== 'group') return;
	const field = defaultField || 'people';
	group.children.push({
		id: generateNodeId('r'),
		type: 'rule',
		field: field,
		operator: getDefaultOperatorForField(field),
		value: getDefaultValueForField(field)
	});
	renderRuleTree();
	syncFromRuleTree();
};

window.rtAddGroup = function(groupId) {
	const group = findNode(state.ruleTree, groupId);
	if (!group || group.type !== 'group') return;
	const childCombiner = group.combiner === 'AND' ? 'OR' : 'AND';
	group.children.push({
		id: generateNodeId('g'),
		type: 'group',
		combiner: childCombiner,
		children: [
			{
				id: generateNodeId('r'),
				type: 'rule',
				field: 'country',
				operator: 'in',
				value: []
			}
		]
	});
	renderRuleTree();
	syncFromRuleTree();
};

window.rtDeleteNode = function(id) {
	const info = findGroupAndIndex(state.ruleTree, id);
	if (!info) return;
	info.parent.children.splice(info.index, 1);
	renderRuleTree();
	syncFromRuleTree();
};

window.rtSetCombiner = function(groupId, combiner) {
	const group = findNode(state.ruleTree, groupId);
	if (!group) return;
	group.combiner = combiner;
	renderRuleTree();
	syncFromRuleTree();
};

window.rtChangeField = function(ruleId, newField) {
	const rule = findNode(state.ruleTree, ruleId);
	if (!rule) return;
	rule.field = newField;
	rule.operator = getDefaultOperatorForField(newField);
	rule.value = getDefaultValueForField(newField);
	delete rule.dateAfter;
	delete rule.dateBefore;
	renderRuleTree();
	syncFromRuleTree();
};

window.rtChangeOperator = function(ruleId, newOp) {
	const rule = findNode(state.ruleTree, ruleId);
	if (!rule) return;
	rule.operator = newOp;
	if (['favorite', 'has_people', 'has_albums', 'has_tags'].includes(rule.field)) {
		rule.value = (newOp === 'true');
	} else if (rule.field === 'media_type' || rule.field === 'visibility') {
		rule.value = newOp;
	} else if (rule.field === 'date') {
		if (newOp === 'after') delete rule.dateBefore;
		else if (newOp === 'before') delete rule.dateAfter;
	}
	renderRuleTree();
	syncFromRuleTree();
};

window.rtToggleMultiValue = function(ruleId, val, e) {
	if (e) {
		e.stopPropagation();
		e.preventDefault();
	}
	const rule = findNode(state.ruleTree, ruleId);
	if (!rule) return;
	if (!Array.isArray(rule.value)) rule.value = [];
	const idx = rule.value.indexOf(val);
	if (idx >= 0) {
		rule.value.splice(idx, 1);
	} else {
		rule.value.push(val);
	}
	renderRuleTree();
	syncFromRuleTree();
	const dd = document.getElementById('dropdown_' + ruleId);
	if (dd) dd.classList.add('open');
	const input = dd ? dd.parentElement.querySelector('.rt-chip-input') : null;
	if (input) input.focus();
};

window.rtRemoveMultiValue = function(ruleId, val, e) {
	if (e) {
		e.stopPropagation();
		e.preventDefault();
	}
	const rule = findNode(state.ruleTree, ruleId);
	if (!rule || !Array.isArray(rule.value)) return;
	rule.value = rule.value.filter(v => v !== val);
	renderRuleTree();
	syncFromRuleTree();
};

window.rtDuplicateRule = function(ruleId) {
	const info = findGroupAndIndex(state.ruleTree, ruleId);
	if (!info || info.node.type !== 'rule') return;
	const clone = JSON.parse(JSON.stringify(info.node));
	clone.id = generateNodeId('r');
	info.parent.children.splice(info.index + 1, 0, clone);
	renderRuleTree();
	syncFromRuleTree();
};

function isMultiIdField(field) {
	return ['people', 'albums', 'tags'].includes(field);
}

window.rtHandleChipKeydown = function(ruleId, e) {
	const dd = document.getElementById('dropdown_' + ruleId);
	const visibleItems = dd ? Array.from(dd.querySelectorAll('.rt-dropdown-item')).filter(el => el.style.display !== 'none') : [];

	if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
		e.preventDefault();
		if (dd && !dd.classList.contains('open')) dd.classList.add('open');
		if (visibleItems.length === 0) return;
		const curIdx = visibleItems.findIndex(el => el.classList.contains('highlighted'));
		visibleItems.forEach(el => el.classList.remove('highlighted'));
		let nextIdx = e.key === 'ArrowDown' ? curIdx + 1 : curIdx - 1;
		if (nextIdx < 0) nextIdx = visibleItems.length - 1;
		if (nextIdx >= visibleItems.length) nextIdx = 0;
		const nextEl = visibleItems[nextIdx];
		nextEl.classList.add('highlighted');
		nextEl.scrollIntoView({ block: 'nearest' });
		return;
	}

	if (e.key === 'Escape') {
		if (dd) {
			dd.classList.remove('open');
			dd.querySelectorAll('.rt-dropdown-item.highlighted').forEach(el => el.classList.remove('highlighted'));
		}
		return;
	}

	if (e.key === 'Backspace' && e.target.value === '') {
		const rule = findNode(state.ruleTree, ruleId);
		if (rule && Array.isArray(rule.value) && rule.value.length > 0) {
			e.preventDefault();
			rule.value.pop();
			renderRuleTree();
			syncFromRuleTree();
			const reopened = document.getElementById('dropdown_' + ruleId);
			if (reopened) reopened.classList.add('open');
			const input = reopened ? reopened.parentElement.querySelector('.rt-chip-input') : null;
			if (input) input.focus();
		}
		return;
	}

	if (e.key === 'Enter') {
		e.preventDefault();
		const rule = findNode(state.ruleTree, ruleId);
		if (!rule) return;
		const highlighted = visibleItems.find(el => el.classList.contains('highlighted'));
		if (highlighted) {
			rtToggleMultiValue(ruleId, highlighted.dataset.value, e);
			return;
		}
		if (isMultiIdField(rule.field)) {
			if (visibleItems.length > 0) {
				rtToggleMultiValue(ruleId, visibleItems[0].dataset.value, e);
			}
			return;
		}
		const val = (e.target.value || '').trim();
		if (!val) return;
		if (!Array.isArray(rule.value)) rule.value = [];
		if (!rule.value.includes(val)) {
			rule.value.push(val);
		}
		renderRuleTree();
		syncFromRuleTree();
	}
};

window.rtSetScalarValue = function(ruleId, val) {
	const rule = findNode(state.ruleTree, ruleId);
	if (!rule) return;
	rule.value = val;
	syncFromRuleTree();
};

window.rtSetDateValue = function(ruleId, prop, val) {
	const rule = findNode(state.ruleTree, ruleId);
	if (!rule) return;
	rule[prop] = val;
	syncFromRuleTree();
};

window.rtOpenDropdown = function(ruleId, e) {
	if (e) e.stopPropagation();
	document.querySelectorAll('.rt-dropdown-menu.open').forEach(el => {
		if (el.id !== 'dropdown_' + ruleId) el.classList.remove('open');
	});
	const dd = document.getElementById('dropdown_' + ruleId);
	if (dd) dd.classList.add('open');
};

window.rtFilterDropdown = function(ruleId, query) {
	const dd = document.getElementById('dropdown_' + ruleId);
	if (!dd) return;
	const q = (query || '').toLowerCase().trim();
	let visibleCount = 0;
	dd.querySelectorAll('.rt-dropdown-item').forEach(item => {
		item.classList.remove('highlighted');
		const txt = item.textContent.toLowerCase();
		const matches = txt.includes(q);
		item.style.display = matches ? 'flex' : 'none';
		if (matches) visibleCount++;
	});
	const rule = findNode(state.ruleTree, ruleId);
	const emptyText = rule && isMultiIdField(rule.field)
		? 'No matching options found'
		: 'Press Enter to add custom value';
	let noMatch = dd.querySelector('.rt-no-match');
	if (visibleCount === 0) {
		if (!noMatch) {
			noMatch = document.createElement('div');
			noMatch.className = 'rt-no-match';
			noMatch.style.cssText = 'padding: 0.5rem 0.65rem; color: var(--text-muted); font-size: 0.75rem;';
			dd.appendChild(noMatch);
		}
		noMatch.textContent = emptyText;
		noMatch.style.display = 'block';
	} else if (noMatch) {
		noMatch.style.display = 'none';
	}
};

// ==========================================================================
// Rule Tree HTML Rendering
// ==========================================================================

function renderRuleTree() {
	const mount = document.getElementById('rule-tree-mount');
	if (!mount) return;
	mount.innerHTML = renderGroupHTML(state.ruleTree, true);
}

function renderGroupHTML(group, isRoot) {
	const isAnd = (group.combiner || 'AND').toUpperCase() === 'AND';
	const hasChildren = group.children && group.children.length > 0;
	const delBtn = !isRoot
		? `<button type="button" class="rt-btn-del" onclick="rtDeleteNode('${group.id}')" title="Delete subgroup">✕</button>`
		: '';

	const header = `
		<div class="rt-group-header">
			<div class="rt-combiner-wrap">
				<div class="rt-combiner-pills">
					<button type="button" class="rt-combiner-btn and ${isAnd ? 'active and' : ''}" onclick="rtSetCombiner('${group.id}', 'AND')">ALL (AND)</button>
					<button type="button" class="rt-combiner-btn or ${!isAnd ? 'active or' : ''}" onclick="rtSetCombiner('${group.id}', 'OR')">ANY (OR)</button>
				</div>
				<span class="rt-group-hint">of the following match:</span>
			</div>
			<div class="rt-group-actions">
				<button type="button" class="btn btn-xs btn-secondary" onclick="rtAddRule('${group.id}')">+ Condition</button>
				<button type="button" class="btn btn-xs btn-secondary" onclick="rtAddGroup('${group.id}')">+ Subgroup</button>
				${delBtn}
			</div>
		</div>
	`;

	let childrenHTML = '<div class="rt-group-children">';
	if (!hasChildren) {
		childrenHTML += `<div class="rt-empty-group">Empty filter (matches all assets). Click <strong>+ Condition</strong> or <strong>+ Subgroup</strong> to add rules.</div>`;
	} else {
		for (const child of group.children) {
			if (child.type === 'rule') {
				childrenHTML += renderRuleHTML(child);
			} else if (child.type === 'group') {
				childrenHTML += renderGroupHTML(child, false);
			}
		}
	}
	childrenHTML += '</div>';

	return `
		<div class="rt-group ${isRoot ? 'rt-root' : 'rt-subgroup'}" id="${group.id}" data-combiner="${isAnd ? 'AND' : 'OR'}">
			${header}
			${childrenHTML}
		</div>
	`;
}

function renderRuleHTML(rule) {
	let fieldSelect = `<select class="rt-select-field" onchange="rtChangeField('${rule.id}', this.value)">`;
	for (const opt of FIELD_DEFINITIONS) {
		fieldSelect += `<option value="${opt.value}" ${rule.field === opt.value ? 'selected' : ''}>${opt.label}</option>`;
	}
	fieldSelect += `</select>`;

	let opSelect = `<select class="rt-select-operator" onchange="rtChangeOperator('${rule.id}', this.value)">`;
	if (rule.field === 'people') {
		opSelect += `<option value="all" ${rule.operator === 'all' ? 'selected' : ''}>contains ALL of</option>`;
		opSelect += `<option value="any" ${rule.operator === 'any' ? 'selected' : ''}>contains ANY of</option>`;
		opSelect += `<option value="none" ${rule.operator === 'none' ? 'selected' : ''}>contains NONE of</option>`;
	} else if (['albums', 'tags'].includes(rule.field)) {
		opSelect += `<option value="any" ${rule.operator === 'any' ? 'selected' : ''}>is in ANY of</option>`;
		opSelect += `<option value="all" ${rule.operator === 'all' ? 'selected' : ''}>is in ALL of</option>`;
		opSelect += `<option value="none" ${rule.operator === 'none' ? 'selected' : ''}>is in NONE of</option>`;
	} else if (['country', 'state', 'city', 'camera', 'make', 'lens'].includes(rule.field)) {
		opSelect += `<option value="in" ${rule.operator === 'in' ? 'selected' : ''}>is one of (IN)</option>`;
		opSelect += `<option value="notIn" ${rule.operator === 'notIn' ? 'selected' : ''}>is NOT one of</option>`;
		opSelect += `<option value="eq" ${rule.operator === 'eq' ? 'selected' : ''}>equals (EQ)</option>`;
	} else if (['favorite', 'has_people', 'has_albums', 'has_tags'].includes(rule.field)) {
		opSelect += `<option value="true" ${rule.operator === 'true' ? 'selected' : ''}>is True (Yes)</option>`;
		opSelect += `<option value="false" ${rule.operator === 'false' ? 'selected' : ''}>is False (No)</option>`;
	} else if (rule.field === 'media_type') {
		opSelect += `<option value="IMAGE" ${rule.operator === 'IMAGE' ? 'selected' : ''}>Photos only (IMAGE)</option>`;
		opSelect += `<option value="VIDEO" ${rule.operator === 'VIDEO' ? 'selected' : ''}>Videos only (VIDEO)</option>`;
		opSelect += `<option value="MOTION" ${rule.operator === 'MOTION' ? 'selected' : ''}>Motion / Live Photos</option>`;
	} else if (rule.field === 'visibility') {
		opSelect += `<option value="timeline" ${rule.operator === 'timeline' ? 'selected' : ''}>Timeline</option>`;
		opSelect += `<option value="archive" ${rule.operator === 'archive' ? 'selected' : ''}>Archived</option>`;
		opSelect += `<option value="hidden" ${rule.operator === 'hidden' ? 'selected' : ''}>Hidden</option>`;
		opSelect += `<option value="locked" ${rule.operator === 'locked' ? 'selected' : ''}>Locked</option>`;
	} else if (rule.field === 'rating') {
		opSelect += `<option value="gte" ${rule.operator === 'gte' ? 'selected' : ''}>at least (>=)</option>`;
		opSelect += `<option value="eq" ${rule.operator === 'eq' ? 'selected' : ''}>equals (=)</option>`;
		opSelect += `<option value="lte" ${rule.operator === 'lte' ? 'selected' : ''}>at most (<=)</option>`;
	} else if (rule.field === 'date') {
		opSelect += `<option value="after" ${rule.operator === 'after' ? 'selected' : ''}>Taken on/after</option>`;
		opSelect += `<option value="before" ${rule.operator === 'before' ? 'selected' : ''}>Taken on/before</option>`;
		opSelect += `<option value="between" ${rule.operator === 'between' ? 'selected' : ''}>Between dates</option>`;
	} else if (['description', 'filename'].includes(rule.field)) {
		opSelect += `<option value="like" ${rule.operator === 'like' ? 'selected' : ''}>contains (LIKE)</option>`;
		opSelect += `<option value="notLike" ${rule.operator === 'notLike' ? 'selected' : ''}>does not contain</option>`;
		opSelect += `<option value="eq" ${rule.operator === 'eq' ? 'selected' : ''}>equals (EQ)</option>`;
		opSelect += `<option value="startsWith" ${rule.operator === 'startsWith' ? 'selected' : ''}>starts with</option>`;
		opSelect += `<option value="endsWith" ${rule.operator === 'endsWith' ? 'selected' : ''}>ends with</option>`;
	} else if (rule.field === 'ocr') {
		opSelect += `<option value="matches" selected>matches text</option>`;
	}
	opSelect += `</select>`;

	let valueBox = `<div class="rt-value-box">`;
	const isMulti = ['people', 'albums', 'tags', 'country', 'state', 'city', 'camera', 'make', 'lens'].includes(rule.field);

	if (isMulti) {
		const available = getFieldOptionsList(rule.field);
		const selectedVals = Array.isArray(rule.value) ? rule.value : [];

		let chips = '';
		for (const val of selectedVals) {
			const matched = available.find(a => a.value === val);
			const label = matched ? matched.label : val;
			chips += `
				<span class="rt-chip" title="${escapeHtml(val)}">
					<span>${escapeHtml(label)}</span>
					<button type="button" class="rt-chip-x" data-action="remove-chip" data-rule-id="${escapeHtml(rule.id)}" data-value="${escapeHtml(val)}" aria-label="Remove ${escapeHtml(label)}">✕</button>
				</span>
			`;
		}

		let dropdownItems = '';
		for (const opt of available) {
			const isSel = selectedVals.includes(opt.value);
			dropdownItems += `
				<div class="rt-dropdown-item ${isSel ? 'selected' : ''}" data-action="toggle-opt" data-rule-id="${escapeHtml(rule.id)}" data-value="${escapeHtml(opt.value)}">
					<span>${escapeHtml(opt.label)}</span>
					${isSel ? '<span>✓</span>' : ''}
				</div>
			`;
		}

		valueBox += `
			<div class="rt-chips-container" data-action="open-dd" data-rule-id="${escapeHtml(rule.id)}">
				${chips}
				<input
					type="text"
					class="rt-chip-input"
					placeholder="${selectedVals.length ? '' : 'Search or type + Enter...'}"
					onfocus="rtOpenDropdown('${escapeHtml(rule.id)}', event)"
					oninput="rtFilterDropdown('${escapeHtml(rule.id)}', this.value)"
					onkeydown="rtHandleChipKeydown('${escapeHtml(rule.id)}', event)"
				>
			</div>
			<div class="rt-dropdown-menu scroller" id="dropdown_${escapeHtml(rule.id)}">
				${dropdownItems || '<div style="padding: 0.5rem 0.65rem; color: var(--text-muted); font-size: 0.75rem;">Type a value and press Enter</div>'}
			</div>
		`;
	} else if (rule.field === 'date') {
		if (rule.operator === 'between') {
			valueBox += `
				<div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
					<input type="date" class="rt-date-input" value="${escapeHtml(rule.dateAfter || '')}" onchange="rtSetDateValue('${rule.id}', 'dateAfter', this.value)">
					<span style="font-size: 0.75rem; color: var(--text-secondary);">to</span>
					<input type="date" class="rt-date-input" value="${escapeHtml(rule.dateBefore || '')}" onchange="rtSetDateValue('${rule.id}', 'dateBefore', this.value)">
				</div>
			`;
		} else {
			const prop = (rule.operator === 'before') ? 'dateBefore' : 'dateAfter';
			valueBox += `
				<input type="date" class="rt-date-input" style="width: 100%;" value="${escapeHtml(rule[prop] || '')}" onchange="rtSetDateValue('${rule.id}', '${prop}', this.value)">
			`;
		}
	} else if (rule.field === 'rating') {
		const parsedRating = parseInt(rule.value, 10);
		const curRating = Number.isFinite(parsedRating) ? parsedRating : 3;
		valueBox += `<select class="rt-select-field" style="width: 100%;" onchange="rtSetScalarValue('${escapeHtml(rule.id)}', parseInt(this.value, 10))">`;
		if (curRating === 0) {
			valueBox += `<option value="0" selected>Unrated (0 Stars)</option>`;
		}
		for (let r = 1; r <= 5; r++) {
			valueBox += `<option value="${r}" ${curRating === r ? 'selected' : ''}>${'★'.repeat(r)} (${r} Star${r > 1 ? 's' : ''})</option>`;
		}
		valueBox += `</select>`;
	} else if (['description', 'filename', 'ocr'].includes(rule.field)) {
		valueBox += `
			<input
				type="text"
				class="rt-text-input"
				placeholder="Enter text pattern..."
				value="${escapeHtml(rule.value || '')}"
				oninput="rtSetScalarValue('${rule.id}', this.value)"
			>
		`;
	} else {
		valueBox += `<span style="font-size: 0.78rem; color: var(--text-muted); font-style: italic;">Active condition</span>`;
	}
	valueBox += `</div>`;

	return `
		<div class="rt-rule" id="${rule.id}">
			${fieldSelect}
			${opSelect}
			${valueBox}
			<button type="button" class="rt-btn-dup" onclick="rtDuplicateRule('${escapeHtml(rule.id)}')" title="Duplicate condition">⧉</button>
			<button type="button" class="rt-btn-del" onclick="rtDeleteNode('${escapeHtml(rule.id)}')" title="Delete condition">✕</button>
		</div>
	`;
}

// ==========================================================================
// Rule Tree <-> Immich SearchFilter JSON Compiler & Decompiler
// ==========================================================================

function compileRuleToBranch(rule) {
	const branch = {};
	const { field, operator, value } = rule;

	if (['favorite', 'media_type', 'visibility', 'rating', 'has_people', 'has_albums', 'has_tags'].includes(field)) {
		// Implicit scalar values
	} else if (field === 'date') {
		const needsAfter = operator === 'after' || operator === 'between' || !operator;
		const needsBefore = operator === 'before' || operator === 'between';
		const hasAfter = needsAfter && !!rule.dateAfter;
		const hasBefore = needsBefore && !!rule.dateBefore;
		if (!hasAfter && !hasBefore) return null;
	} else if (['description', 'filename', 'ocr'].includes(field)) {
		if (!value || String(value).trim() === '') return null;
	} else {
		if (!value || (Array.isArray(value) && value.length === 0)) return null;
	}

	switch (field) {
		case 'people':
			branch.personIds = { [operator || 'all']: Array.isArray(value) ? value : [value] };
			break;
		case 'albums':
			branch.albumIds = { [operator || 'any']: Array.isArray(value) ? value : [value] };
			break;
		case 'tags':
			branch.tagIds = { [operator || 'any']: Array.isArray(value) ? value : [value] };
			break;
		case 'country':
		case 'state':
		case 'city': {
			if (operator === 'eq') branch[field] = { eq: Array.isArray(value) ? value[0] : value };
			else if (operator === 'notIn') branch[field] = { notIn: Array.isArray(value) ? value : [value] };
			else branch[field] = { in: Array.isArray(value) ? value : [value] };
			break;
		}
		case 'camera': {
			if (operator === 'eq') branch.model = { eq: Array.isArray(value) ? value[0] : value };
			else if (operator === 'notIn') branch.model = { notIn: Array.isArray(value) ? value : [value] };
			else branch.model = { in: Array.isArray(value) ? value : [value] };
			break;
		}
		case 'make': {
			if (operator === 'eq') branch.make = { eq: Array.isArray(value) ? value[0] : value };
			else if (operator === 'notIn') branch.make = { notIn: Array.isArray(value) ? value : [value] };
			else branch.make = { in: Array.isArray(value) ? value : [value] };
			break;
		}
		case 'lens': {
			if (operator === 'eq') branch.lensModel = { eq: Array.isArray(value) ? value[0] : value };
			else if (operator === 'notIn') branch.lensModel = { notIn: Array.isArray(value) ? value : [value] };
			else branch.lensModel = { in: Array.isArray(value) ? value : [value] };
			break;
		}
		case 'favorite':
			branch.isFavorite = { eq: operator === 'true' || value === true };
			break;
		case 'media_type':
			if (operator === 'MOTION' || value === 'MOTION') {
				branch.isMotion = { eq: true };
			} else {
				branch.type = { in: [operator || value || 'IMAGE'] };
			}
			break;
		case 'visibility':
			branch.visibility = { in: [operator || value || 'timeline'] };
			break;
		case 'rating': {
			const op = ['gte', 'eq', 'lte'].includes(operator) ? operator : 'gte';
			const parsed = parseInt(value, 10);
			branch.rating = { [op]: Number.isFinite(parsed) ? parsed : 3 };
			break;
		}
		case 'has_people':
			branch.hasPeople = { eq: operator === 'true' || value === true };
			break;
		case 'has_albums':
			branch.hasAlbums = { eq: operator === 'true' || value === true };
			break;
		case 'has_tags':
			branch.hasTags = { eq: operator === 'true' || value === true };
			break;
		case 'date':
			branch.takenAt = {};
			if ((operator === 'after' || operator === 'between' || !operator) && rule.dateAfter) {
				branch.takenAt.gte = rule.dateAfter;
			}
			if ((operator === 'before' || operator === 'between') && rule.dateBefore) {
				branch.takenAt.lte = rule.dateBefore;
			}
			break;
		case 'description':
			branch.description = { [operator || 'like']: String(value).trim() };
			break;
		case 'filename':
			branch.originalFileName = { [operator || 'like']: String(value).trim() };
			break;
		case 'ocr':
			branch.ocr = { matches: String(value).trim() };
			break;
	}

	return Object.keys(branch).length > 0 ? branch : null;
}

function mergeFilterBranches(left, right) {
	const merged = { ...left };
	for (const [key, value] of Object.entries(right)) {
		const existing = merged[key];
		if (existing && value && typeof existing === 'object' && typeof value === 'object' &&
			!Array.isArray(existing) && !Array.isArray(value)) {
			const combined = { ...existing };
			for (const [op, opVal] of Object.entries(value)) {
				if (Array.isArray(combined[op]) && Array.isArray(opVal)) {
					combined[op] = Array.from(new Set([...combined[op], ...opVal]));
				} else {
					combined[op] = opVal;
				}
			}
			merged[key] = combined;
		} else {
			merged[key] = value;
		}
	}
	return merged;
}

function compileOrGroupToBranches(group) {
	if (!group || !group.children) return [];
	const branches = [];
	for (const child of group.children) {
		if (child.type === 'rule') {
			const b = compileRuleToBranch(child);
			if (b && Object.keys(b).length > 0) branches.push(b);
		} else if (child.type === 'group') {
			const childCombiner = (child.combiner || 'AND').toUpperCase();
			if (childCombiner === 'OR') {
				branches.push(...compileOrGroupToBranches(child));
			} else {
				const andRes = compileAndGroup(child);
				if (andRes.or && andRes.or.length > 0) {
					const direct = Object.assign({}, andRes);
					delete direct.or;
					for (const orBranch of andRes.or) {
						const merged = mergeFilterBranches(direct, orBranch);
						if (Object.keys(merged).length > 0) branches.push(merged);
					}
				} else if (Object.keys(andRes).length > 0) {
					branches.push(andRes);
				}
			}
		}
	}
	return branches.filter(b => b && Object.keys(b).length > 0 && !b.or);
}

function compileAndGroup(group) {
	if (!group || !group.children) return {};
	let root = {};
	let orBranches = [];

	for (const child of group.children) {
		if (child.type === 'rule') {
			const b = compileRuleToBranch(child);
			if (b && Object.keys(b).length > 0) root = mergeFilterBranches(root, b);
		} else if (child.type === 'group') {
			const childCombiner = (child.combiner || 'AND').toUpperCase();
			if (childCombiner === 'OR') {
				const subBranches = compileOrGroupToBranches(child);
				if (subBranches.length > 0) {
					if (orBranches.length === 0) {
						orBranches = subBranches;
					} else {
						const combined = [];
						for (const b1 of orBranches) {
							for (const b2 of subBranches) {
								combined.push(mergeFilterBranches(b1, b2));
							}
						}
						orBranches = combined;
					}
				}
			} else {
				const subAnd = compileAndGroup(child);
				if (subAnd.or && subAnd.or.length > 0) {
					if (orBranches.length === 0) {
						orBranches = subAnd.or;
					} else {
						const combined = [];
						for (const b1 of orBranches) {
							for (const b2 of subAnd.or) {
								combined.push(mergeFilterBranches(b1, b2));
							}
						}
						orBranches = combined;
					}
					delete subAnd.or;
				}
				if (Object.keys(subAnd).length > 0) {
					root = mergeFilterBranches(root, subAnd);
				}
			}
		}
	}

	orBranches = orBranches.filter(b => b && Object.keys(b).length > 0 && !b.or);
	if (orBranches.length > 0) {
		root.or = orBranches;
	}
	return root;
}

function compileGroupToAST(group) {
	if (!group || !group.children || group.children.length === 0) return {};
	const combiner = (group.combiner || 'AND').toUpperCase();
	if (combiner === 'OR') {
		const branches = compileOrGroupToBranches(group);
		return branches.length > 0 ? { or: branches } : {};
	}
	return compileAndGroup(group);
}

function parseFieldToRules(key, val, children) {
	if (val === null || val === undefined) return;
	if (key === 'personIds' || key === 'albumIds' || key === 'tagIds') {
		const field = key === 'personIds' ? 'people' : (key === 'albumIds' ? 'albums' : 'tags');
		if (Array.isArray(val)) {
			children.push({ id: generateNodeId('r'), type: 'rule', field, operator: 'any', value: val });
		} else if (typeof val === 'string') {
			children.push({ id: generateNodeId('r'), type: 'rule', field, operator: 'any', value: [val] });
		} else if (typeof val === 'object') {
			for (const op of ['all', 'any', 'none']) {
				if (Array.isArray(val[op]) && val[op].length > 0) {
					children.push({ id: generateNodeId('r'), type: 'rule', field, operator: op, value: val[op] });
				}
			}
		}
	} else if (['country', 'state', 'city', 'model', 'make', 'lensModel'].includes(key)) {
		const field = key === 'model' ? 'camera' : (key === 'lensModel' ? 'lens' : key);
		if (typeof val === 'string') {
			children.push({ id: generateNodeId('r'), type: 'rule', field, operator: 'eq', value: [val] });
		} else if (Array.isArray(val)) {
			children.push({ id: generateNodeId('r'), type: 'rule', field, operator: 'in', value: val });
		} else if (typeof val === 'object') {
			if (val.eq !== undefined && val.eq !== '') {
				children.push({ id: generateNodeId('r'), type: 'rule', field, operator: 'eq', value: [val.eq] });
			}
			for (const op of ['in', 'notIn']) {
				if (Array.isArray(val[op]) && val[op].length > 0) {
					children.push({ id: generateNodeId('r'), type: 'rule', field, operator: op, value: val[op] });
				}
			}
		}
	} else if (key === 'isFavorite') {
		const boolVal = typeof val === 'boolean' ? val : !!val.eq;
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'favorite', operator: boolVal ? 'true' : 'false', value: boolVal });
	} else if (key === 'isMotion') {
		if (val === true || (typeof val === 'object' && val.eq === true)) {
			children.push({ id: generateNodeId('r'), type: 'rule', field: 'media_type', operator: 'MOTION', value: 'MOTION' });
		}
	} else if (key === 'type') {
		const t = typeof val === 'string' ? val : (val.in ? val.in[0] : (val.eq || 'IMAGE'));
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'media_type', operator: t, value: t });
	} else if (key === 'visibility') {
		const vis = typeof val === 'string' ? val : (val.in ? val.in[0] : (val.eq || 'timeline'));
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'visibility', operator: vis, value: vis });
	} else if (key === 'rating') {
		if (typeof val === 'number') {
			children.push({ id: generateNodeId('r'), type: 'rule', field: 'rating', operator: 'eq', value: val });
		} else if (typeof val === 'object') {
			for (const op of ['eq', 'gte', 'lte']) {
				if (val[op] !== undefined && val[op] !== null) {
					children.push({ id: generateNodeId('r'), type: 'rule', field: 'rating', operator: op, value: val[op] });
				}
			}
		}
	} else if (key === 'hasPeople') {
		const b = typeof val === 'boolean' ? val : !!val.eq;
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'has_people', operator: b ? 'true' : 'false', value: b });
	} else if (key === 'hasAlbums') {
		const b = typeof val === 'boolean' ? val : !!val.eq;
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'has_albums', operator: b ? 'true' : 'false', value: b });
	} else if (key === 'hasTags') {
		const b = typeof val === 'boolean' ? val : !!val.eq;
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'has_tags', operator: b ? 'true' : 'false', value: b });
	} else if (key === 'takenAt') {
		const gte = (val.gte || '').slice(0, 10);
		const lte = (val.lte || '').slice(0, 10);
		const op = (gte && lte) ? 'between' : (lte ? 'before' : 'after');
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'date', operator: op, dateAfter: gte, dateBefore: lte });
	} else if (key === 'description' || key === 'originalFileName') {
		const field = key === 'originalFileName' ? 'filename' : 'description';
		if (typeof val === 'string') {
			children.push({ id: generateNodeId('r'), type: 'rule', field, operator: 'like', value: val });
		} else if (typeof val === 'object') {
			const knownOps = ['like', 'notLike', 'eq', 'startsWith', 'endsWith'];
			let pushed = false;
			for (const op of knownOps) {
				if (val[op] !== undefined) {
					children.push({ id: generateNodeId('r'), type: 'rule', field, operator: op, value: val[op] || '' });
					pushed = true;
				}
			}
			if (!pushed) {
				const firstOp = Object.keys(val)[0] || 'like';
				children.push({ id: generateNodeId('r'), type: 'rule', field, operator: firstOp, value: val[firstOp] || '' });
			}
		}
	} else if (key === 'ocr') {
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'ocr', operator: 'matches', value: val.matches || '' });
	}
}

function astToRuleGroup(ast) {
	if (!ast || typeof ast !== 'object') return null;

	const directRules = [];
	for (const [key, val] of Object.entries(ast)) {
		if (key === 'or') continue;
		parseFieldToRules(key, val, directRules);
	}

	const hasOr = Array.isArray(ast.or) && ast.or.length > 0;
	if (!hasOr) {
		return {
			id: generateNodeId('g'),
			type: 'group',
			combiner: 'AND',
			children: directRules
		};
	}

	const orBranches = [];
	for (const branch of ast.or) {
		const grp = astToRuleGroup(branch);
		if (grp && grp.children) {
			if (grp.children.length === 1) {
				orBranches.push(grp.children[0]);
			} else if (grp.children.length > 1) {
				orBranches.push(grp);
			}
		}
	}

	if (directRules.length === 0) {
		return {
			id: generateNodeId('g'),
			type: 'group',
			combiner: 'OR',
			children: orBranches
		};
	}

	const children = [...directRules];
	if (orBranches.length > 0) {
		children.push({
			id: generateNodeId('g'),
			type: 'group',
			combiner: 'OR',
			children: orBranches
		});
	}
	return {
		id: generateNodeId('g'),
		type: 'group',
		combiner: 'AND',
		children
	};
}

// ==========================================================================
// Synchronization & Live Search
// ==========================================================================

function setJsonSyncStatus(kind, text) {
	const badge = document.getElementById('json-sync-badge');
	const box = document.getElementById('json-editor-box');
	const applyBtn = document.getElementById('btn-apply-json');
	if (!badge) return;

	badge.className = 'sync-badge';
	if (kind === 'valid') {
		badge.classList.add('sync-valid');
		if (box) box.classList.remove('has-error');
		if (applyBtn) applyBtn.disabled = false;
	} else if (kind === 'dirty') {
		badge.classList.add('sync-dirty');
		if (box) box.classList.remove('has-error');
		if (applyBtn) applyBtn.disabled = false;
	} else {
		badge.classList.add('sync-error');
		if (box) box.classList.add('has-error');
		if (applyBtn) applyBtn.disabled = true;
	}
	badge.textContent = text;
}

function updateCodeViewers(ast, skipFilterEditor) {
	const jsonStr = (ast && Object.keys(ast).length > 0) ? JSON.stringify(ast, null, 2) : '{}';
	const filterEditor = document.getElementById('filter-json-editor');
	if (filterEditor && !skipFilterEditor) {
		filterEditor.value = jsonStr;
		setJsonSyncStatus('valid', '✓ Synced with Tree');
	}

	// Update URL query string without reloading
	const url = new URL(window.location.href);
	const defaults = state.defaults || { sampleSize: 24, searchMode: 'random', includeVideos: true, includeArchived: false };
	if (jsonStr && jsonStr !== '{}') {
		url.searchParams.set('filter', JSON.stringify(ast));
	} else {
		url.searchParams.delete('filter');
	}
	if (state.selectedUser) {
		url.searchParams.set('user', state.selectedUser);
	} else {
		url.searchParams.delete('user');
	}
	if (state.activeProfileId) {
		url.searchParams.set('profile', state.activeProfileId);
	} else {
		url.searchParams.delete('profile');
	}
	if (state.searchMode !== (defaults.searchMode || 'random')) {
		url.searchParams.set('mode', state.searchMode);
	} else {
		url.searchParams.delete('mode');
	}
	if (state.searchMode === 'metadata' && (state.orderByField !== 'localDateTime' || state.orderByDirection !== 'desc')) {
		url.searchParams.set('sort', `${state.orderByField}:${state.orderByDirection}`);
	} else {
		url.searchParams.delete('sort');
	}
	if (state.sampleSize !== (defaults.sampleSize || 24)) {
		url.searchParams.set('limit', String(state.sampleSize));
	} else {
		url.searchParams.delete('limit');
	}
	if (state.includeVideos !== (defaults.includeVideos !== false)) {
		url.searchParams.set('videos', state.includeVideos ? '1' : '0');
	} else {
		url.searchParams.delete('videos');
	}
	if (state.includeArchived !== !!defaults.includeArchived) {
		url.searchParams.set('archived', state.includeArchived ? '1' : '0');
	} else {
		url.searchParams.delete('archived');
	}
	window.history.replaceState({}, '', url.toString());

	updateRequestAndCurlPreviews();
}

function updateRequestAndCurlPreviews() {
	const endpoint = state.searchMode === 'metadata' ? '/api/search/metadata' : '/api/search/random';
	const hintEl = document.getElementById('endpoint-hint-label');
	if (hintEl) hintEl.textContent = 'POST ' + endpoint;

	const reqViewer = document.getElementById('request-body-viewer');
	if (reqViewer) {
		reqViewer.value = state.lastRequestBodyJson || '{}';
	}

	const curlViewer = document.getElementById('curl-viewer');
	if (curlViewer) {
		const baseUrl = state.immichUrl || 'http://localhost:2283';
		const bodyCompact = state.lastRequestBodyJson || '{}';
		const activeUser = state.selectedUser;
		const apiKeyPlaceholder = activeUser
			? `$IMMICH_API_KEY_${activeUser.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
			: '$IMMICH_API_KEY';

		curlViewer.value = [
			`curl -X POST "${baseUrl}${endpoint}" \\`,
			`  -H "Content-Type: application/json" \\`,
			`  -H "x-api-key: ${apiKeyPlaceholder}" \\`,
			`  -d '${bodyCompact.replace(/'/g, "'\\''")}'`
		].join('\n');
	}
}

function syncFromRuleTree(opts = {}) {
	const ast = compileGroupToAST(state.ruleTree);
	updateCodeViewers(ast, opts.skipFilterEditor);
	if (!profileHistoryApplying) recordProfileHistory();
	scheduleLiveSearch(JSON.stringify(ast));
}

function scheduleLiveSearch(filterJsonStr, delay = 220) {
	if (searchDebounceTimer) {
		clearTimeout(searchDebounceTimer);
		searchDebounceTimer = null;
	}
	searchDebounceTimer = setTimeout(() => {
		searchDebounceTimer = null;
		runLiveSearch(filterJsonStr);
	}, delay);
}

async function runLiveSearch(filterJsonStr) {
	// Cancel any pending debounced search so it won't fire after this search
	if (searchDebounceTimer) {
		clearTimeout(searchDebounceTimer);
		searchDebounceTimer = null;
	}

	if (activeSearchController) {
		activeSearchController.abort();
	}
	activeSearchController = new AbortController();
	const thisSeq = ++searchSequenceId;

	const countBadge = document.getElementById('results-count-badge');
	if (countBadge) countBadge.textContent = 'Searching Immich...';

	const editorEl = document.getElementById('filter-json-editor');
	const rawFilter = filterJsonStr !== undefined ? filterJsonStr : (editorEl ? editorEl.value : '{}');

	try {
		const resp = await fetch('/api/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal: activeSearchController.signal,
			body: JSON.stringify({
				filterJson: rawFilter,
				user: state.selectedUser,
				limit: state.sampleSize,
				searchMode: state.searchMode,
				orderByField: state.orderByField,
				orderByDirection: state.orderByDirection,
				includeVideos: state.includeVideos,
				includeArchived: state.includeArchived
			})
		});

		const data = await resp.json();
		// If a newer search was dispatched while this request was in flight, ignore stale response
		if (thisSeq !== searchSequenceId) {
			return;
		}
		renderSearchResults(data);
	} catch (err) {
		// If aborted or superseded by a newer search, drop silent without error
		if (thisSeq !== searchSequenceId || err.name === 'AbortError') {
			return;
		}
		renderSearchResults({ error: err.message || 'Network request failed' });
	}
}

function renderSearchResults(data) {
	const errEl = document.getElementById('results-error');
	const emptyEl = document.getElementById('results-empty');
	const gridEl = document.getElementById('assets-grid');
	const loadMoreWrap = document.getElementById('load-more-wrap');
	const countBadge = document.getElementById('results-count-badge');

	if (data.requestBodyJson) {
		state.lastRequestBodyJson = data.requestBodyJson;
		updateRequestAndCurlPreviews();
	}

	if (data.error) {
		if (errEl) {
			errEl.hidden = false;
			errEl.textContent = data.error;
		}
		if (emptyEl) emptyEl.hidden = true;
		if (gridEl) gridEl.innerHTML = '';
		if (loadMoreWrap) loadMoreWrap.hidden = true;
		if (countBadge) countBadge.textContent = 'Error';
		return;
	}

	if (errEl) errEl.hidden = true;
	const assets = data.assets || [];
	state.lastAssets = assets;

	const total = data.total || 0;
	const exact = data.totalExact !== false;

	if (countBadge) {
		if (assets.length === 0) {
			countBadge.textContent = '0 matching';
		} else if (total > assets.length) {
			countBadge.textContent = `${total.toLocaleString()}${exact ? '' : '+'} matching (showing ${assets.length})`;
		} else if (!exact) {
			countBadge.textContent = `${total.toLocaleString()}+ matching (showing ${assets.length})`;
		} else {
			countBadge.textContent = `All ${assets.length.toLocaleString()} matching shown`;
		}
	}

	if (assets.length === 0) {
		if (emptyEl) emptyEl.hidden = false;
		if (gridEl) gridEl.innerHTML = '';
		if (loadMoreWrap) loadMoreWrap.hidden = true;
		return;
	}

	if (emptyEl) emptyEl.hidden = true;
	if (loadMoreWrap) {
		loadMoreWrap.hidden = !((total > assets.length || !exact) && state.sampleSize < 200);
		const loadMoreBtn = document.getElementById('btn-load-more');
		if (loadMoreBtn) {
			let nextSize = 200;
			if (state.sampleSize < 48) nextSize = 48;
			else if (state.sampleSize < 96) nextSize = 96;
			else if (state.sampleSize < 144) nextSize = 144;
			loadMoreBtn.textContent = `Load More Assets (show ${nextSize})`;
		}
	}

	if (gridEl) {
		gridEl.innerHTML = assets.map((item, idx) => {
			const loc = [item.city, item.country].filter(Boolean).join(', ');
			const peopleStr = (item.people || []).join(', ');
			const camStr = [item.make, item.model].filter(Boolean).join(' ');

			return `
				<article class="asset-card" onclick="openAssetModal(${idx})" title="Click to inspect full details">
					<div class="asset-thumb-wrap">
						<img
							src="${escapeHtml(item.thumbnailUrl)}"
							alt="${escapeHtml(item.filename || 'Asset thumbnail')}"
							loading="lazy"
							class="asset-thumb-img"
						>
						<div class="asset-badges">
							${item.type === 'VIDEO' ? '<span class="badge-pill badge-video">▶ VIDEO</span>' : ''}
							${item.isFavorite ? '<span class="badge-pill badge-fav">♥</span>' : ''}
							${item.rating > 0 ? `<span class="badge-pill badge-rating">★ ${item.rating}</span>` : ''}
							${item.user ? `<button type="button" class="badge-pill badge-user interactive-badge" data-filter-account="${escapeHtml(item.user)}" title="Click to filter by @${escapeHtml(item.user)}">@${escapeHtml(item.user)}</button>` : ''}
						</div>
					</div>
					<div class="asset-meta">
						${item.takenAt ? `<div class="asset-meta-date">${escapeHtml(item.takenAt)}</div>` : ''}
						${loc ? `<div class="asset-meta-loc" title="${escapeHtml(loc)}">📍 ${escapeHtml(loc)}</div>` : ''}
						${peopleStr ? `<div class="asset-meta-people" title="${escapeHtml(peopleStr)}">👤 ${escapeHtml(peopleStr)}</div>` : ''}
						${camStr ? `<div class="asset-meta-cam" title="${escapeHtml(camStr)}">📷 ${escapeHtml(camStr)}</div>` : ''}
					</div>
				</article>
			`;
		}).join('');
	}
}

// ==========================================================================
// Asset Lightbox Dialog
// ==========================================================================

function resolveMetadataIdByName(list, name) {
	if (!Array.isArray(list) || !name) return '';
	const target = String(name).trim().toLowerCase();
	const exact = list.find(item => String(item.label || '').toLowerCase() === target);
	if (exact) return exact.id;
	const prefixed = list.find(item => String(item.label || '').toLowerCase().startsWith(target + ' (@'));
	return prefixed ? prefixed.id : '';
}

window.addQuickFilterFromAsset = function(field, value) {
	if (!field || value === undefined || value === null || value === '') return;
	let op = 'in';
	let ruleVal = [value];
	if (field === 'people') {
		op = 'all';
		const resolved = resolveMetadataIdByName(state.metadata.people, value);
		if (!resolved) return;
		ruleVal = [resolved];
	} else if (field === 'tags') {
		op = 'any';
		const resolved = resolveMetadataIdByName(state.metadata.tags, value);
		if (!resolved) return;
		ruleVal = [resolved];
	}

	if (!state.ruleTree || state.ruleTree.type !== 'group') {
		state.ruleTree = { id: 'root', type: 'group', combiner: 'AND', children: [] };
	} else if ((state.ruleTree.combiner || 'AND').toUpperCase() !== 'AND') {
		state.ruleTree = {
			id: generateNodeId('g'),
			type: 'group',
			combiner: 'AND',
			children: [state.ruleTree]
		};
	}

	state.ruleTree.children.push({
		id: generateNodeId('r'),
		type: 'rule',
		field,
		operator: op,
		value: ruleVal
	});

	const dialog = document.getElementById('asset-dialog');
	if (dialog && dialog.open) dialog.close();
	renderRuleTree();
	syncFromRuleTree();
};

window.openAssetModal = function(index) {
	const item = state.lastAssets[index];
	if (!item) return;

	state.lightboxIndex = index;
	const dialog = document.getElementById('asset-dialog');
	const titleEl = document.getElementById('asset-dialog-title');
	const bodyEl = document.getElementById('asset-dialog-body');
	const prevBtn = document.getElementById('btn-lightbox-prev');
	const nextBtn = document.getElementById('btn-lightbox-next');
	const counterEl = document.getElementById('lightbox-counter');
	if (!dialog || !bodyEl) return;

	if (titleEl) {
		titleEl.textContent = item.filename || item.id;
	}
	if (counterEl) {
		counterEl.textContent = `${index + 1} / ${state.lastAssets.length}`;
	}
	if (prevBtn) prevBtn.disabled = index <= 0;
	if (nextBtn) nextBtn.disabled = index >= state.lastAssets.length - 1;

	const mediaHtml = item.type === 'VIDEO'
		? `<video src="${escapeHtml(item.originalUrl)}" controls autoplay playsinline></video>`
		: `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.filename)}">`;

	const locButtons = [
		item.city ? `<button type="button" class="meta-filter-btn" data-quick-field="city" data-quick-value="${escapeHtml(item.city)}" title="Filter by city">📍 ${escapeHtml(item.city)}</button>` : '',
		item.state ? `<span>${escapeHtml(item.state)}</span>` : '',
		item.country ? `<button type="button" class="meta-filter-btn" data-quick-field="country" data-quick-value="${escapeHtml(item.country)}" title="Filter by country">🌍 ${escapeHtml(item.country)}</button>` : ''
	].filter(Boolean).join(' ');

	const peopleButtons = (item.people || []).map(name => {
		const hasId = !!resolveMetadataIdByName(state.metadata.people, name);
		return hasId
			? `<button type="button" class="meta-filter-btn" data-quick-field="people" data-quick-value="${escapeHtml(name)}" title="Filter by ${escapeHtml(name)}">👤 ${escapeHtml(name)}</button>`
			: `<span class="meta-filter-btn" style="cursor:default;">👤 ${escapeHtml(name)}</span>`;
	}).join('');

	const tagButtons = (item.tags || []).map(label => {
		const hasId = !!resolveMetadataIdByName(state.metadata.tags, label);
		return hasId
			? `<button type="button" class="meta-filter-btn" data-quick-field="tags" data-quick-value="${escapeHtml(label)}" title="Filter by tag ${escapeHtml(label)}">🏷️ ${escapeHtml(label)}</button>`
			: `<span class="meta-filter-btn" style="cursor:default;">🏷️ ${escapeHtml(label)}</span>`;
	}).join('');

	const camParts = [item.make, item.model ? `<button type="button" class="meta-filter-btn" data-quick-field="camera" data-quick-value="${escapeHtml(item.model)}" title="Filter by camera model">📷 ${escapeHtml(item.model)}</button>` : '', item.lensModel].filter(Boolean).join(' · ');

	const statusBadges = [];
	if (item.isFavorite) statusBadges.push('<span class="badge-pill badge-fav">♥ Favorite</span>');
	if (item.rating > 0) statusBadges.push(`<span class="badge-pill badge-rating">${'★'.repeat(item.rating)} (${item.rating}/5)</span>`);
	if (item.isArchived) statusBadges.push('<span class="badge-pill badge-video">Archived</span>');

	bodyEl.innerHTML = `
		<div class="dialog-media-box">
			${mediaHtml}
		</div>
		<div class="dialog-meta-list">
			<div class="meta-row">
				<span class="meta-label">Asset ID</span>
				<span class="meta-val"><code>${escapeHtml(item.id)}</code></span>
			</div>
			${statusBadges.length ? `
			<div class="meta-row">
				<span class="meta-label">Status & Rating</span>
				<span class="meta-val" style="display:flex;gap:0.35rem;flex-wrap:wrap;">${statusBadges.join('')}</span>
			</div>` : ''}
			${item.user ? `
			<div class="meta-row">
				<span class="meta-label">Account</span>
				<span class="meta-val"><button type="button" class="badge-pill badge-user interactive-badge" data-filter-account="${escapeHtml(item.user)}" title="Filter by @${escapeHtml(item.user)}">@${escapeHtml(item.user)}</button></span>
			</div>` : ''}
			${item.takenAt ? `
			<div class="meta-row">
				<span class="meta-label">Date Taken</span>
				<span class="meta-val">${escapeHtml(item.takenAt)}</span>
			</div>` : ''}
			${locButtons ? `
			<div class="meta-row">
				<span class="meta-label">Location</span>
				<div class="meta-filter-chips">${locButtons}</div>
			</div>` : ''}
			${peopleButtons ? `
			<div class="meta-row">
				<span class="meta-label">People</span>
				<div class="meta-filter-chips">${peopleButtons}</div>
			</div>` : ''}
			${tagButtons ? `
			<div class="meta-row">
				<span class="meta-label">Tags</span>
				<div class="meta-filter-chips">${tagButtons}</div>
			</div>` : ''}
			${camParts ? `
			<div class="meta-row">
				<span class="meta-label">Camera & Lens</span>
				<div class="meta-val">${camParts}</div>
			</div>` : ''}
			${item.description ? `
			<div class="meta-row">
				<span class="meta-label">Description</span>
				<span class="meta-val pretty-text">${escapeHtml(item.description)}</span>
			</div>` : ''}
			${(item.width && item.height) ? `
			<div class="meta-row">
				<span class="meta-label">Dimensions</span>
				<span class="meta-val">${item.width} × ${item.height}</span>
			</div>` : ''}
			<div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap;">
				${item.immichWebUrl ? `<a href="${escapeHtml(item.immichWebUrl)}" target="_blank" rel="noopener" class="btn btn-sm btn-primary" style="text-decoration: none;">Open in Immich ↗</a>` : ''}
				<a href="${escapeHtml(item.originalUrl)}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="text-decoration: none;">View Original File ↗</a>
			</div>
		</div>
	`;

	if (!dialog.open) dialog.showModal();
};

function setupDialogLightDismissFallback() {
	const assetDialog = document.getElementById('asset-dialog');
	if (assetDialog) {
		// Stop playing video when modal closes
		assetDialog.addEventListener('close', () => {
			const bodyEl = document.getElementById('asset-dialog-body');
			if (bodyEl) bodyEl.innerHTML = '';
		});
	}

	// Mandatory fallback for browsers without closedby="any" support
	if (!('closedBy' in HTMLDialogElement.prototype)) {
		document.querySelectorAll('dialog[closedby="any"]').forEach(dialog => {
			dialog.addEventListener('click', (event) => {
				if (event.target !== dialog) return;
				const rect = dialog.getBoundingClientRect();
				const isDialogContent = (
					rect.top <= event.clientY &&
					event.clientY <= rect.top + rect.height &&
					rect.left <= event.clientX &&
					event.clientX <= rect.left + rect.width
				);
				if (isDialogContent) return;
				dialog.close();
			});
		});
	}
}

// ==========================================================================
// Bootstrap & Event Listeners
// ==========================================================================

async function bootstrapApp() {
	const urlParams = new URLSearchParams(window.location.search);
	const initialUser = urlParams.get('user') || '';
	const initialFilter = urlParams.get('filter') || '';
	const initialProfile = urlParams.get('profile') || '';
	const initialMode = urlParams.get('mode') || '';
	const initialSort = urlParams.get('sort') || '';
	const initialLimit = urlParams.get('limit') || '';
	const initialVideos = urlParams.get('videos');
	const initialArchived = urlParams.get('archived');

	try {
		const resp = await fetch('/api/bootstrap' + (initialUser ? `?user=${encodeURIComponent(initialUser)}` : ''));
		const data = await resp.json();

		state.immichUrl = data.immichUrl || '';
		state.externalUrl = data.externalUrl || '';
		state.accounts = data.accounts || [];
		state.accountDetails = data.accountDetails || [];
		state.selectedUser = data.selectedUser || '';
		state.metadata = data.metadata || state.metadata;

		if (data.defaults) {
			state.defaults = {
				sampleSize: data.defaults.sampleSize || 24,
				searchMode: data.defaults.searchMode || 'random',
				includeVideos: data.defaults.includeVideos !== false,
				includeArchived: !!data.defaults.includeArchived
			};
			state.sampleSize = state.defaults.sampleSize;
			state.searchMode = state.defaults.searchMode;
			state.includeVideos = state.defaults.includeVideos;
			state.includeArchived = state.defaults.includeArchived;
		}

		updateConnectionBanner(data);
		populateAccountsSelector();
		await loadProfiles();

		if (initialProfile && state.profiles.some(p => p.id === initialProfile)) {
			applyProfile(initialProfile);
			return;
		}

		if (initialMode === 'random' || initialMode === 'metadata') {
			state.searchMode = initialMode;
		}
		if (initialSort && initialSort.includes(':')) {
			const [field, dir] = initialSort.split(':');
			if (field) state.orderByField = field;
			if (dir === 'asc' || dir === 'desc') state.orderByDirection = dir;
		}
		if (initialLimit) {
			const parsedLimit = parseInt(initialLimit, 10);
			if (Number.isFinite(parsedLimit) && parsedLimit > 0 && parsedLimit <= 250) {
				state.sampleSize = parsedLimit;
			}
		}
		if (initialVideos === '0' || initialVideos === '1') {
			state.includeVideos = initialVideos === '1';
		}
		if (initialArchived === '0' || initialArchived === '1') {
			state.includeArchived = initialArchived === '1';
		}

		syncToolbarControls();

		// Initialize Rule Tree from ?filter= or default starter rule
		if (initialFilter && initialFilter.trim() !== '' && initialFilter.trim() !== '{}') {
			try {
				const parsed = JSON.parse(initialFilter);
				const group = astToRuleGroup(parsed);
				if (group) state.ruleTree = group;
			} catch (e) {
				console.warn('Invalid initial ?filter param:', e);
			}
		} else {
			state.ruleTree = {
				id: 'root',
				type: 'group',
				combiner: 'AND',
				children: [
					{ id: generateNodeId('r'), type: 'rule', field: 'people', operator: 'all', value: [] }
				]
			};
		}

		renderRuleTree();
		syncFromRuleTree();
	} catch (err) {
		const dot = document.getElementById('connection-dot');
		const lbl = document.getElementById('connection-label');
		if (dot) dot.className = 'status-dot error';
		if (lbl) lbl.textContent = 'Connection error';
	}
}

function updateConnectionBanner(data) {
	const dot = document.getElementById('connection-dot');
	const lbl = document.getElementById('connection-label');
	const banner = document.getElementById('global-warning-banner');

	if (data.configured) {
		if (dot) dot.className = 'status-dot connected';
		if (lbl) {
			try {
				const parsed = new URL(data.immichUrl);
				lbl.textContent = parsed.host;
			} catch (_) {
				lbl.textContent = data.immichUrl;
			}
		}
	} else {
		if (dot) dot.className = 'status-dot error';
		if (lbl) lbl.textContent = 'Not Configured';
	}

	if (banner) {
		if (data.warnings && data.warnings.length > 0) {
			banner.hidden = false;
			banner.textContent = '⚠️ ' + data.warnings.join(' | ');
		} else {
			banner.hidden = true;
		}
	}
}

function populateAccountsSelector() {
	const pillWrap = document.getElementById('account-identity-pill');
	const pillName = document.getElementById('account-identity-name');
	const dropdownWrap = document.getElementById('account-dropdown-wrap');
	const nativeSelect = document.getElementById('account-select');

	if (nativeSelect) {
		nativeSelect.innerHTML = `<option value="">All Accounts (${state.accounts.length})</option>` +
			state.accounts.map(u => `<option value="${escapeHtml(u)}" ${state.selectedUser === u ? 'selected' : ''}>@${escapeHtml(u)}</option>`).join('');
		nativeSelect.value = state.selectedUser || '';
	}

	if (state.accounts.length === 0) {
		if (pillWrap) pillWrap.hidden = true;
		if (dropdownWrap) dropdownWrap.hidden = true;
		return;
	}

	if (state.accounts.length === 1) {
		// Single account: show clean identity pill
		if (dropdownWrap) dropdownWrap.hidden = true;
		if (pillWrap) {
			pillWrap.hidden = false;
			const accName = state.accounts[0];
			if (pillName) pillName.textContent = `@${accName}`;
		}
		return;
	}

	// Multiple accounts: show interactive switcher
	if (pillWrap) pillWrap.hidden = true;
	if (dropdownWrap) {
		dropdownWrap.hidden = false;
		updateAccountSwitcherLabel();
		renderAccountMenu();
	}
}

function updateAccountSwitcherLabel() {
	const btnLabel = document.getElementById('account-btn-label');
	const btnIcon = document.getElementById('account-btn-icon');
	if (!btnLabel) return;

	if (state.selectedUser) {
		btnLabel.textContent = `@${state.selectedUser}`;
		if (btnIcon) btnIcon.textContent = '👤';
	} else {
		btnLabel.textContent = `All Accounts (${state.accounts.length})`;
		if (btnIcon) btnIcon.textContent = '👥';
	}
}

function renderAccountMenu() {
	const menuPopover = document.getElementById('account-menu-popover');
	if (!menuPopover) return;

	const healthMap = {};
	(state.accountDetails || []).forEach(a => { healthMap[a.name] = a.valid; });

	const isAllActive = !state.selectedUser;
	let itemsHtml = `
		<button type="button" class="account-menu-item ${isAllActive ? 'active' : ''}" data-select-account="" role="option" aria-selected="${isAllActive}">
			<span>👥 All Accounts (${state.accounts.length})</span>
			<span class="account-item-status ok" title="Queries all accounts in parallel"></span>
		</button>
		<hr style="border:0;border-top:1px solid var(--border-color);margin:0.25rem 0;">
	`;

	itemsHtml += state.accounts.map(acc => {
		const isActive = (state.selectedUser === acc);
		const isOk = healthMap[acc] !== false;
		return `
			<button type="button" class="account-menu-item ${isActive ? 'active' : ''}" data-select-account="${escapeHtml(acc)}" role="option" aria-selected="${isActive}">
				<span>👤 @${escapeHtml(acc)}</span>
				<span class="account-item-status ${isOk ? 'ok' : 'err'}" title="${isOk ? 'Active & authenticated' : 'Metadata query reported warnings/errors'}"></span>
			</button>
		`;
	}).join('');

	menuPopover.innerHTML = itemsHtml;
}

async function fetchMetadataForUser(user, forceRefresh = false) {
	const query = user ? `?user=${encodeURIComponent(user)}` : '';
	const endpoint = forceRefresh ? '/api/metadata/refresh' : '/api/metadata';
	const method = forceRefresh ? 'POST' : 'GET';
	try {
		const resp = await fetch(endpoint + query, { method });
		const data = await resp.json();
		if (data.metadata) state.metadata = data.metadata;
		if (data.accountHealth) {
			const healthMap = {};
			(state.accountDetails || []).forEach(a => { healthMap[a.name] = a.valid; });
			Object.keys(data.accountHealth).forEach(k => { healthMap[k] = data.accountHealth[k]; });
			const names = state.accounts.length > 0 ? state.accounts : Object.keys(healthMap);
			state.accountDetails = names.map(name => ({
				name,
				valid: healthMap[name] !== false
			}));
			renderAccountMenu();
		}
		const banner = document.getElementById('global-warning-banner');
		if (banner) {
			if (data.warnings && data.warnings.length > 0) {
				banner.hidden = false;
				banner.textContent = '⚠️ ' + data.warnings.join(' | ');
			} else {
				banner.hidden = true;
			}
		}
		renderRuleTree();
	} catch (e) {
		console.warn('Metadata fetch failed:', e);
	}
}

window.selectAccount = async function(accountName) {
	state.selectedUser = accountName || '';
	const nativeSelect = document.getElementById('account-select');
	if (nativeSelect) nativeSelect.value = state.selectedUser;

	updateAccountSwitcherLabel();
	renderAccountMenu();
	closeAccountMenu();

	const url = new URL(window.location);
	if (state.selectedUser) {
		url.searchParams.set('user', state.selectedUser);
	} else {
		url.searchParams.delete('user');
	}
	window.history.replaceState({}, '', url);

	await fetchMetadataForUser(state.selectedUser, false);
	syncFromRuleTree();
};

window.filterByAccount = function(accountName) {
	selectAccount(accountName);
};

function toggleAccountMenu() {
	const popover = document.getElementById('account-menu-popover');
	const btn = document.getElementById('account-switcher-btn');
	if (!popover || !btn) return;
	const isExpanded = btn.getAttribute('aria-expanded') === 'true';
	if (isExpanded) {
		closeAccountMenu();
	} else {
		popover.hidden = false;
		btn.setAttribute('aria-expanded', 'true');
	}
}

function closeAccountMenu() {
	const popover = document.getElementById('account-menu-popover');
	const btn = document.getElementById('account-switcher-btn');
	if (popover) popover.hidden = true;
	if (btn) btn.setAttribute('aria-expanded', 'false');
}

function openConnectionDialog() {
	const dialog = document.getElementById('connection-dialog');
	if (!dialog) return;

	const urlEl = document.getElementById('dialog-server-url');
	const extRow = document.getElementById('dialog-ext-url-row');
	const extUrlEl = document.getElementById('dialog-ext-url');
	const statusEl = document.getElementById('dialog-server-status');
	const countEl = document.getElementById('dialog-accounts-count');
	const listEl = document.getElementById('dialog-accounts-list');

	if (urlEl) urlEl.textContent = state.immichUrl || 'Not configured';
	if (extRow && extUrlEl) {
		if (state.externalUrl && state.externalUrl !== state.immichUrl) {
			extRow.hidden = false;
			extUrlEl.textContent = state.externalUrl;
		} else {
			extRow.hidden = true;
		}
	}

	if (statusEl) {
		statusEl.innerHTML = state.immichUrl
			? '<span class="status-dot connected" style="display:inline-block;margin-right:6px;"></span> Connected'
			: '<span class="status-dot error" style="display:inline-block;margin-right:6px;"></span> Not configured';
	}

	if (countEl) countEl.textContent = state.accounts.length;

	if (listEl) {
		if (state.accounts.length === 0) {
			listEl.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);padding:0.5rem;">No accounts configured. Define <code>accounts:</code> in <code>config.yaml</code>.</div>';
		} else {
			const healthMap = {};
			(state.accountDetails || []).forEach(a => { healthMap[a.name] = a.valid; });

			listEl.innerHTML = state.accounts.map(acc => {
				const isOk = healthMap[acc] !== false;
				const isSelected = (state.selectedUser === acc);
				return `
					<div class="connection-account-row">
						<div class="connection-account-name">
							<span>👤</span>
							<span>@${escapeHtml(acc)}</span>
							${isSelected ? '<span class="badge-pill badge-rating" style="font-size:0.68rem;">ACTIVE</span>' : ''}
						</div>
						<span class="connection-account-status ${isOk ? 'ok' : 'err'}">
							<span class="status-dot ${isOk ? 'connected' : 'error'}"></span>
							${isOk ? 'Authenticated' : 'Warning/Error'}
						</span>
					</div>
				`;
			}).join('');
		}
	}

	dialog.showModal();
}

function syncToolbarControls() {
	const vidToggle = document.getElementById('toggle-include-videos');
	if (vidToggle) vidToggle.checked = state.includeVideos;

	const archToggle = document.getElementById('toggle-include-archived');
	if (archToggle) archToggle.checked = state.includeArchived;

	document.querySelectorAll('.seg-btn[data-search-mode], .mode-toggle-btn[data-search-mode]').forEach(btn => {
		const isActive = btn.dataset.searchMode === state.searchMode;
		btn.classList.toggle('active', isActive);
		btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
	});

	const randomPanel = document.getElementById('random-mode-panel');
	const sortedPanel = document.getElementById('sorted-mode-panel');
	if (randomPanel) randomPanel.hidden = (state.searchMode !== 'random');
	if (sortedPanel) sortedPanel.hidden = (state.searchMode !== 'metadata');

	const sortSelect = document.getElementById('metadata-sort-select');
	if (sortSelect && state.orderByField) {
		sortSelect.value = `${state.orderByField}:${state.orderByDirection}`;
	}

	document.querySelectorAll('.limit-pill').forEach(btn => {
		btn.classList.toggle('active', parseInt(btn.dataset.limit, 10) === state.sampleSize);
	});
}

function applyJsonEditorToTree() {
	const editor = document.getElementById('filter-json-editor');
	if (!editor) return;
	const text = (editor.value || '').trim();

	if (!text || text === '{}') {
		state.ruleTree = { id: 'root', type: 'group', combiner: 'AND', children: [] };
		renderRuleTree();
		syncFromRuleTree();
		return;
	}

	try {
		const parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			setJsonSyncStatus('error', '⚠️ Filter must be a JSON object {...}');
			return;
		}
		const targetAst = (parsed.filter && typeof parsed.filter === 'object') ? parsed.filter : parsed;
		const group = astToRuleGroup(targetAst);
		state.ruleTree = group || { id: 'root', type: 'group', combiner: 'AND', children: [] };
		renderRuleTree();
		syncFromRuleTree({ skipFilterEditor: false });
		setJsonSyncStatus('valid', '✓ Applied to Tree');
	} catch (err) {
		setJsonSyncStatus('error', '⚠️ ' + err.message);
	}
}

// ==========================================================================
// Search Profiles
// ==========================================================================

async function loadProfiles() {
	let serverProfiles = [];
	let serverProfilesLoaded = false;
	try {
		const resp = await fetch('/api/profiles');
		if (resp.ok) {
			const data = await resp.json();
			if (Array.isArray(data.profiles)) {
				serverProfiles = data.profiles;
				serverProfilesLoaded = true;
			}
		}
	} catch (err) {
		console.warn('Could not fetch profiles from server, falling back to localStorage:', err);
	}

	let localProfiles = [];
	try {
		const stored = localStorage.getItem('immich_search_profiles');
		if (stored) {
			localProfiles = JSON.parse(stored);
		}
	} catch (e) {}

	const serverProfileIds = new Set(serverProfiles.map(profile => profile && profile.id).filter(Boolean));
	const profileMap = new Map();
	for (const p of localProfiles) {
		if (!p || !p.id) continue;
		if (serverProfilesLoaded && p.deletePending && !serverProfileIds.has(p.id)) continue;
		if (serverProfilesLoaded && p.serverBacked && !p.pendingSync && !serverProfileIds.has(p.id)) continue;
		const localProfile = { ...p };
		if (serverProfileIds.has(p.id)) delete localProfile.deletePending;
		profileMap.set(p.id, localProfile);
	}
	for (const p of serverProfiles) {
		if (!p || !p.id) continue;
		const serverProfile = { ...p, serverBacked: true };
		const localProfile = profileMap.get(p.id);
		if (!localProfile || !localProfile.pendingSync || !isLocalPendingProfileNewer(localProfile, serverProfile)) {
			profileMap.set(p.id, serverProfile);
		} else {
			localProfile.serverBacked = true;
		}
	}

	state.profiles = Array.from(profileMap.values());
	if (serverProfilesLoaded) {
		saveProfilesToLocalStorage(state.profiles);
	}
	savedProfileSnapshots.clear();
	for (const profile of state.profiles) {
		savedProfileSnapshots.set(profile.id, JSON.stringify(profile));
	}
	renderProfilesDropdown();
}

function isLocalPendingProfileNewer(localProfile, serverProfile) {
	const profileFields = [
		'id', 'name', 'isDefault', 'filterJson', 'ruleTree', 'history', 'historyIndex',
		'searchMode', 'user', 'limit', 'orderByField', 'orderByDirection',
		'includeVideos', 'includeArchived'
	];
	const hasSameSavedData = profileFields.every(field =>
		JSON.stringify(localProfile[field]) === JSON.stringify(serverProfile[field])
	);
	if (hasSameSavedData) return false;

	const localUpdatedAt = Date.parse(localProfile.updatedAt || '');
	const serverUpdatedAt = Date.parse(serverProfile.updatedAt || '');
	if (!Number.isFinite(localUpdatedAt) || !Number.isFinite(serverUpdatedAt)) return true;
	return localUpdatedAt >= serverUpdatedAt;
}

function renderProfilesDropdown() {
	const selectEl = document.getElementById('profile-select');
	const deleteBtn = document.getElementById('btn-delete-profile');
	if (!selectEl) return;

	selectEl.innerHTML = '<option value="">Custom Filter</option>';
	for (const p of state.profiles) {
		const opt = document.createElement('option');
		opt.value = p.id;
		const dirtyPrefix = (p.id === state.activeProfileId && isProfileDirty(p.id)) ? '• ' : '';
		opt.textContent = `${dirtyPrefix}📁 ${p.name}`;
		selectEl.appendChild(opt);
	}

	selectEl.value = state.activeProfileId || '';
	if (deleteBtn) {
		deleteBtn.hidden = !(state.activeProfileId && state.activeProfileId.startsWith('prof_'));
	}
	updateProfileActionLabels();
}

function updateProfileActionLabels() {
	const saveButton = document.getElementById('btn-save-profile');
	const discardButton = document.getElementById('btn-discard-profile');
	const hasActiveProfile = !!(state.activeProfileId && state.activeProfileId.startsWith('prof_'));
	const profile = hasActiveProfile ? state.profiles.find(item => item.id === state.activeProfileId) : null;
	const hasUnsavedChanges = hasActiveProfile && isProfileDirty(state.activeProfileId);
	const needsServerSync = hasActiveProfile && !!(profile && profile.pendingSync);

	if (discardButton) {
		discardButton.hidden = !hasUnsavedChanges;
	}

	const selectEl = document.getElementById('profile-select');
	if (selectEl && hasActiveProfile && profile) {
		const activeOpt = Array.from(selectEl.options).find(opt => opt.value === state.activeProfileId);
		if (activeOpt) {
			activeOpt.textContent = `${hasUnsavedChanges ? '• ' : ''}📁 ${profile.name}`;
		}
	}

	if (!saveButton) return;
	saveButton.classList.toggle('btn-unsaved', hasUnsavedChanges);
	saveButton.innerHTML = hasActiveProfile
		? (hasUnsavedChanges
			? '<span>💾 Save Changes</span>'
			: (needsServerSync ? '<span>↥ Sync to Server</span>' : '<span>✏️ Rename</span>'))
		: '<span>💾 Save as Profile</span>';
	saveButton.title = hasActiveProfile
		? (hasUnsavedChanges
			? 'Save the current filter and settings to this profile (Ctrl+S)'
			: (needsServerSync ? 'Sync this browser-saved profile to the server' : 'Rename the selected profile'))
		: 'Save the current filter as a new profile (Ctrl+S)';
}

function getProfileSnapshot() {
	return {
		filterJson: JSON.stringify(compileGroupToAST(state.ruleTree)),
		ruleTree: JSON.parse(JSON.stringify(state.ruleTree)),
		searchMode: state.searchMode,
		user: state.selectedUser,
		limit: state.sampleSize,
		orderByField: state.orderByField,
		orderByDirection: state.orderByDirection,
		includeVideos: state.includeVideos,
		includeArchived: state.includeArchived
	};
}

function getHistoryTreeNodes(tree) {
	const nodes = { rules: new Map(), groups: new Map() };
	function visit(node) {
		if (!node) return;
		if (node.type === 'group') {
			if (node.id) nodes.groups.set(node.id, node);
			(node.children || []).forEach(visit);
		} else if (node.type === 'rule' && node.id) {
			nodes.rules.set(node.id, node);
		}
	}
	visit(tree);
	return nodes;
}

function getHistoryFieldLabel(field) {
	const definition = FIELD_DEFINITIONS.find(item => item.value === field);
	return definition ? definition.label.replace(/^\S+\s*/, '') : String(field || 'Unknown field').replace(/_/g, ' ');
}

function getHistoryRuleValue(rule, includeMetadata = false) {
	if (rule.field === 'date') {
		if (rule.operator === 'between') {
			return [rule.dateAfter, rule.dateBefore].filter(Boolean).join(' to ');
		}
		if (rule.operator === 'before') {
			return rule.dateBefore || '';
		}
		return rule.dateAfter || '';
	}
	if (Array.isArray(rule.value)) {
		if (!rule.value.length) return '';
		const definition = FIELD_DEFINITIONS.find(item => item.value === rule.field);
		const isIDList = definition && definition.type === 'multi-id';
		if (isIDList && !includeMetadata) return `${rule.value.length} selected`;
		const options = isIDList ? getFieldOptionsList(rule.field) : [];
		const values = rule.value.map(value => {
			if (!isIDList) return String(value);
			const option = options.find(item => item.value === value);
			return option ? option.label : '';
		});
		const missingCount = values.filter(value => !value).length;
		const availableValues = values.filter(Boolean);
		if (isIDList && missingCount) {
			if (!availableValues.length) return `${rule.value.length} selected`;
			availableValues.push(`${missingCount} other selected`);
		}
		const shownValues = availableValues.slice(0, 2);
		if (availableValues.length > 2) shownValues.push(`+${availableValues.length - 2} more`);
		return shownValues.join(', ');
	}
	if (['favorite', 'has_people', 'has_albums', 'has_tags', 'media_type', 'visibility'].includes(rule.field)) {
		return '';
	}
	return rule.value === null || rule.value === undefined ? '' : String(rule.value);
}

function getHistoryRuleCondition(rule, includeMetadata = false) {
	const value = getHistoryRuleValue(rule, includeMetadata);
	const isSelfDescribing = ['favorite', 'has_people', 'has_albums', 'has_tags', 'media_type', 'visibility'].includes(rule.field);
	if (!value && !isSelfDescribing) return '';
	if (rule.field === 'people') {
		const operator = { all: 'includes all of', any: 'includes any of', none: 'includes none of' }[rule.operator];
		return [operator, value].filter(Boolean).join(' ');
	}
	if (['albums', 'tags'].includes(rule.field)) {
		const operator = { any: 'is in any of', all: 'is in all of', none: 'is in none of' }[rule.operator];
		return [operator, value].filter(Boolean).join(' ');
	}
	if (['favorite', 'has_people', 'has_albums', 'has_tags'].includes(rule.field)) {
		return rule.operator === 'false' || rule.value === false ? 'is false' : 'is true';
	}
	if (rule.field === 'media_type') {
		return { IMAGE: 'Photos only', VIDEO: 'Videos only', MOTION: 'Motion / Live Photos' }[rule.operator] || '';
	}
	if (rule.field === 'visibility') {
		return { timeline: 'In timeline', archive: 'Archived', hidden: 'Hidden', locked: 'Locked' }[rule.operator] || '';
	}
	const operators = {
		in: 'is one of', notIn: 'is not one of', eq: 'equals',
		gte: 'is at least', lte: 'is at most',
		after: 'is on or after', before: 'is on or before', between: 'is between',
		all: 'contains all of', any: 'contains any of', none: 'contains none of',
		like: 'contains', notLike: 'does not contain', startsWith: 'starts with',
		endsWith: 'ends with', matches: 'matches'
	};
	const operator = operators[rule.operator] || rule.operator || '';
	return [operator, value].filter(Boolean).join(' ');
}

function describeHistoryRule(rule, includeMetadata = false) {
	const field = getHistoryFieldLabel(rule.field);
	const condition = getHistoryRuleCondition(rule, includeMetadata);
	return `${field}: ${condition || field}`;
}

function summarizeHistoryRules(rules, includeMetadata = false) {
	const summaries = rules.slice(0, 3).map(rule => describeHistoryRule(rule, includeMetadata));
	if (rules.length > summaries.length) summaries.push(`+${rules.length - summaries.length} more`);
	return summaries.join('; ');
}

function getHistoryFilterChange(previousTree, nextTree, includeMetadata = false) {
	const previous = getHistoryTreeNodes(previousTree);
	const next = getHistoryTreeNodes(nextTree);
	let added = [...next.rules.values()].filter(rule => !previous.rules.has(rule.id));
	let removed = [...previous.rules.values()].filter(rule => !next.rules.has(rule.id));
	const changed = [...next.rules.values()].filter(rule => {
		const oldRule = previous.rules.get(rule.id);
		if (!oldRule) return false;
		const { id: _oldID, ...oldValues } = oldRule;
		const { id: _newID, ...newValues } = rule;
		return JSON.stringify(oldValues) !== JSON.stringify(newValues);
	});
	const groupChanges = [...next.groups.values()].filter(group => {
		const oldGroup = previous.groups.get(group.id);
		return oldGroup && (oldGroup.combiner || 'AND') !== (group.combiner || 'AND');
	});

	if (added.length > 0 && removed.length > 0) {
		const ruleSignature = r => JSON.stringify([r.field, r.operator, r.value, r.dateAfter || '', r.dateBefore || '']);
		const removedRemaining = [...removed];
		const filteredAdded = [];
		for (const r of added) {
			const sig = ruleSignature(r);
			const matchIdx = removedRemaining.findIndex(rem => ruleSignature(rem) === sig);
			if (matchIdx >= 0) {
				removedRemaining.splice(matchIdx, 1);
			} else {
				filteredAdded.push(r);
			}
		}
		added = filteredAdded;
		removed = removedRemaining;
	}

	if (added.length === 1 && !removed.length && !changed.length && !groupChanges.length) {
		const rule = added[0];
		return {
			label: `Added ${getHistoryFieldLabel(rule.field)} filter`,
			detail: getHistoryRuleCondition(rule, includeMetadata)
		};
	}
	if (removed.length === 1 && !added.length && !changed.length && !groupChanges.length) {
		const rule = removed[0];
		return {
			label: `Removed ${getHistoryFieldLabel(rule.field)} filter`,
			detail: getHistoryRuleCondition(rule, includeMetadata)
		};
	}
	if (changed.length === 1 && !added.length && !removed.length && !groupChanges.length) {
		const oldRule = previous.rules.get(changed[0].id);
		const newRule = changed[0];
		const newField = getHistoryFieldLabel(newRule.field);
		if (oldRule.field !== newRule.field) {
			return {
				label: 'Changed filter field',
				detail: `${describeHistoryRule(oldRule, includeMetadata)} → ${describeHistoryRule(newRule, includeMetadata)}`
			};
		}
		if (oldRule.operator !== newRule.operator) {
			return {
				label: `Changed ${newField} condition`,
				detail: `${getHistoryRuleCondition(oldRule, includeMetadata)} → ${getHistoryRuleCondition(newRule, includeMetadata)}`
			};
		}
		return {
			label: `Changed ${newField} values`,
			detail: `${getHistoryRuleValue(oldRule, includeMetadata) || 'Empty'} → ${getHistoryRuleValue(newRule, includeMetadata) || 'Empty'}`
		};
	}

	if (groupChanges.length === 1 && !added.length && !removed.length && !changed.length) {
		const group = groupChanges[0];
		const oldGroup = previous.groups.get(group.id);
		return {
			label: 'Changed filter logic',
			detail: `${(oldGroup.combiner || 'AND').toUpperCase()} → ${(group.combiner || 'AND').toUpperCase()}`
		};
	}

	const details = [];
	if (added.length) details.push(`Added: ${summarizeHistoryRules(added, includeMetadata)}`);
	if (removed.length) details.push(`Removed: ${summarizeHistoryRules(removed, includeMetadata)}`);
	if (changed.length) details.push(`Changed: ${summarizeHistoryRules(changed, includeMetadata)}`);
	if (groupChanges.length) details.push(`${groupChanges.length} group logic change${groupChanges.length === 1 ? '' : 's'}`);
	return {
		label: 'Updated filters',
		detail: details.join('; ') || 'Filter structure changed'
	};
}

function getHistoryDescription(previous, next, includeMetadata = false) {
	if (JSON.stringify(previous.ruleTree) !== JSON.stringify(next.ruleTree)) {
		return getHistoryFilterChange(previous.ruleTree, next.ruleTree, includeMetadata);
	}
	if (previous.searchMode !== next.searchMode) {
		const modes = { random: 'Random sample', metadata: 'Sorted timeline' };
		return { label: 'Changed search mode', detail: `${modes[previous.searchMode] || previous.searchMode} → ${modes[next.searchMode] || next.searchMode}` };
	}
	if (previous.user !== next.user) {
		return { label: 'Changed target account', detail: `${previous.user || 'All accounts'} → ${next.user || 'All accounts'}` };
	}
	if (previous.orderByField !== next.orderByField || previous.orderByDirection !== next.orderByDirection) {
		return { label: 'Changed sort order', detail: `${previous.orderByField} (${previous.orderByDirection}) → ${next.orderByField} (${next.orderByDirection})` };
	}
	if (previous.limit !== next.limit) {
		return { label: 'Changed display limit', detail: `${previous.limit} → ${next.limit} assets` };
	}
	if (previous.includeVideos !== next.includeVideos || previous.includeArchived !== next.includeArchived) {
		const options = snapshot => [
			snapshot.includeVideos ? 'Videos included' : 'Videos excluded',
			snapshot.includeArchived ? 'Archived included' : 'Archived excluded'
		].join(', ');
		return { label: 'Changed media options', detail: `${options(previous)} → ${options(next)}` };
	}
	return { label: 'Updated profile', detail: '' };
}

function getProfileHistoryEntryDescription(history, index) {
	const entry = history[index];
	const previous = history[index - 1];
	if (entry.detail !== undefined) {
		return { label: entry.label || 'Updated profile', detail: entry.detail };
	}
	if (previous && previous.snapshot && entry.snapshot) {
		return getHistoryDescription(previous.snapshot, entry.snapshot, true);
	}
	return { label: entry.label || 'Updated profile', detail: '' };
}

function setProfileHistoryStatus(message, failed = false) {
	const status = document.getElementById('profile-history-status');
	if (!status) return;
	status.textContent = message;
	status.classList.toggle('error', failed);
}

function getActiveHistoryContext() {
	if (state.activeProfileId) {
		const profile = state.profiles.find(p => p.id === state.activeProfileId);
		if (profile) {
			return { isProfile: true, target: profile };
		}
	}
	return { isProfile: false, target: customHistory };
}

function renderProfileHistory() {
	const list = document.getElementById('profile-history-list');
	const undoButton = document.getElementById('btn-undo-profile');
	const redoButton = document.getElementById('btn-redo-profile');
	const countBadge = document.getElementById('profile-history-count');
	const ctx = getActiveHistoryContext();
	const target = ctx.target;
	const history = ctx.isProfile ? target.history : target.entries;
	const rawIndex = ctx.isProfile ? target.historyIndex : target.index;
	if (!list || !undoButton || !redoButton) return;

	list.replaceChildren();
	if (!Array.isArray(history) || history.length === 0) {
		undoButton.disabled = true;
		redoButton.disabled = true;
		if (countBadge) countBadge.textContent = '0';
		setProfileHistoryStatus(ctx.isProfile ? 'Select a saved profile to track changes.' : 'Edit filters to track session changes, or select a profile.');
		return;
	}

	if (countBadge) countBadge.textContent = String(history.length);
	const historyIndex = Math.max(0, Math.min(rawIndex || 0, history.length - 1));
	undoButton.disabled = historyIndex <= 0;
	redoButton.disabled = historyIndex >= history.length - 1;
	for (let i = history.length - 1; i >= 0; i--) {
		const entry = history[i];
		const item = document.createElement('li');
		const button = document.createElement('button');
		const label = document.createElement('span');
		const detail = document.createElement('span');
		const time = document.createElement('time');
		const description = getProfileHistoryEntryDescription(history, i);
		button.type = 'button';
		button.className = 'profile-history-entry' + (i === historyIndex ? ' active' : '');
		button.setAttribute('aria-current', i === historyIndex ? 'true' : 'false');
		label.className = 'profile-history-label';
		label.textContent = description.label;
		detail.className = 'profile-history-detail';
		detail.textContent = description.detail;
		detail.hidden = !description.detail;
		button.title = description.detail ? `${description.label}: ${description.detail}` : description.label;
		const date = new Date(entry.timestamp);
		time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
		button.append(label, detail, time);
		button.addEventListener('click', () => restoreProfileHistory(i));
		item.appendChild(button);
		list.appendChild(item);
	}
}

function isProfileDirty(profileId) {
	const profile = state.profiles.find(item => item.id === profileId);
	if (!profile) return false;
	const savedSnapshot = savedProfileSnapshots.get(profileId);
	return savedSnapshot === undefined || JSON.stringify(profile) !== savedSnapshot;
}

function isActiveProfileDirty() {
	return !!state.activeProfileId && isProfileDirty(state.activeProfileId);
}

function saveProfilesToLocalStorage(profiles = state.profiles) {
	try {
		localStorage.setItem('immich_search_profiles', JSON.stringify(profiles));
		return true;
	} catch (err) {
		console.warn('Could not save profiles to local storage:', err);
		return false;
	}
}

function replaceProfileWithSavedSnapshot(profileId) {
	const savedSnapshot = savedProfileSnapshots.get(profileId);
	const profileIndex = state.profiles.findIndex(item => item.id === profileId);
	if (savedSnapshot === undefined || profileIndex < 0) return false;
	state.profiles[profileIndex] = JSON.parse(savedSnapshot);
	return true;
}

function discardActiveProfileChanges() {
	const profileId = state.activeProfileId;
	if (!replaceProfileWithSavedSnapshot(profileId)) {
		state.profiles = state.profiles.filter(item => item.id !== profileId);
		savedProfileSnapshots.delete(profileId);
		state.activeProfileId = '';
		renderProfilesDropdown();
		renderProfileHistory();
		return true;
	}
	applyProfile(profileId);
	return true;
}

async function saveActiveProfile() {
	const profile = state.profiles.find(item => item.id === state.activeProfileId);
	if (!profile) return false;

	const saveButton = document.getElementById('btn-save-profile');
	if (saveButton) saveButton.disabled = true;
	setProfileHistoryStatus('Saving profile changes…');

	const previousUpdatedAt = profile.updatedAt;
	profile.updatedAt = new Date().toISOString();
	let savedToServer = false;
	try {
		const response = await fetch('/api/profiles', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(profile)
		});
		if (!response.ok) throw new Error(`Profile save failed (${response.status})`);
		const data = await response.json();
		if (data.profile && data.profile.updatedAt) {
			profile.updatedAt = data.profile.updatedAt;
		}
		savedToServer = true;
	} catch (err) {
		console.warn('Could not save profile to server:', err);
	}

	const wasPendingSync = profile.pendingSync;
	if (savedToServer) {
		delete profile.pendingSync;
		profile.serverBacked = true;
	} else {
		profile.pendingSync = true;
	}
	const savedLocally = saveProfilesToLocalStorage();
	if (!savedToServer && !savedLocally) {
		if (wasPendingSync === undefined) delete profile.pendingSync;
		else profile.pendingSync = wasPendingSync;
		profile.updatedAt = previousUpdatedAt;
		if (saveButton) saveButton.disabled = false;
		updateProfileActionLabels();
		setProfileHistoryStatus('Could not save changes. Check the server or browser storage and try again.', true);
		return false;
	}

	savedProfileSnapshots.set(profile.id, JSON.stringify(profile));
	if (saveButton) saveButton.disabled = false;
	updateProfileActionLabels();
	setProfileHistoryStatus(
		savedToServer ? 'Saved to server profile storage.' : 'Saved in this browser only; server save failed.',
		!savedToServer
	);
	return true;
}

function promptUnsavedProfileAction() {
	const dialog = document.getElementById('unsaved-profile-dialog');
	const message = document.getElementById('unsaved-profile-message');
	if (!dialog || !message) {
		setProfileHistoryStatus('Cannot prompt for unsaved profile changes.', true);
		return Promise.resolve('cancel');
	}

	const profile = state.profiles.find(item => item.id === state.activeProfileId);
	message.textContent = `Save changes to "${profile ? profile.name : 'this profile'}" before continuing?`;
	return new Promise(resolve => {
		resolveUnsavedProfilePrompt = resolve;
		dialog.showModal();
	});
}

function finishUnsavedProfilePrompt(action) {
	if (!resolveUnsavedProfilePrompt) return;
	const resolve = resolveUnsavedProfilePrompt;
	resolveUnsavedProfilePrompt = null;
	const dialog = document.getElementById('unsaved-profile-dialog');
	if (dialog && dialog.open) dialog.close();
	resolve(action);
}

async function resolveUnsavedProfileChanges() {
	if (!isActiveProfileDirty()) return true;
	const action = await promptUnsavedProfileAction();
	if (action === 'save') return saveActiveProfile();
	if (action === 'discard') return discardActiveProfileChanges();
	return false;
}

async function handleProfileSelection(profileId) {
	const previousProfileId = state.activeProfileId;
	if (profileId === previousProfileId) return;
	if (!(await resolveUnsavedProfileChanges())) {
		const selectEl = document.getElementById('profile-select');
		if (selectEl) selectEl.value = previousProfileId;
		return;
	}
	applyProfile(profileId);
}

function recordProfileHistory() {
	if (!state.activeProfileId) {
		const snapshot = getProfileSnapshot();
		if (customHistory.entries.length === 0) {
			customHistory.entries.push({
				label: 'Session started',
				detail: '',
				timestamp: new Date().toISOString(),
				snapshot
			});
			customHistory.index = 0;
			renderProfileHistory();
			return;
		}
		const idx = Math.max(0, Math.min(customHistory.index, customHistory.entries.length - 1));
		const previous = customHistory.entries[idx].snapshot;
		if (JSON.stringify(previous) === JSON.stringify(snapshot)) {
			renderProfileHistory();
			return;
		}
		const wasAtEnd = idx === customHistory.entries.length - 1;
		customHistory.entries.splice(idx + 1);
		const description = getHistoryDescription(previous, snapshot, true);
		const now = new Date();
		const lastEntry = customHistory.entries[customHistory.entries.length - 1];
		const baseSnapshot = customHistory.entries.length >= 2 ? customHistory.entries[customHistory.entries.length - 2].snapshot : null;
		if (wasAtEnd && lastEntry && lastEntry.label === description.label && now.getTime() - new Date(lastEntry.timestamp).getTime() < 750) {
			const coalescedDesc = baseSnapshot ? getHistoryDescription(baseSnapshot, snapshot, true) : description;
			lastEntry.label = coalescedDesc.label;
			lastEntry.detail = coalescedDesc.detail;
			lastEntry.timestamp = now.toISOString();
			lastEntry.snapshot = snapshot;
		} else {
			customHistory.entries.push({
				label: description.label,
				detail: description.detail,
				timestamp: now.toISOString(),
				snapshot
			});
		}
		if (customHistory.entries.length > PROFILE_HISTORY_LIMIT) {
			customHistory.entries.splice(0, customHistory.entries.length - PROFILE_HISTORY_LIMIT);
		}
		customHistory.index = customHistory.entries.length - 1;
		renderProfileHistory();
		setProfileHistoryStatus('Session history (unsaved custom filter).');
		return;
	}
	const profile = state.profiles.find(p => p.id === state.activeProfileId);
	if (!profile) return;

	if (!Array.isArray(profile.history) || profile.history.length === 0) {
		profile.history = [{
			label: 'Profile saved',
			detail: '',
			timestamp: new Date().toISOString(),
			snapshot: getProfileSnapshot()
		}];
		profile.historyIndex = 0;
	}

	const historyIndex = Math.max(0, Math.min(profile.historyIndex || 0, profile.history.length - 1));
	const snapshot = getProfileSnapshot();
	const previous = profile.history[historyIndex].snapshot;
	if (JSON.stringify(previous) === JSON.stringify(snapshot)) return;

	const wasAtHistoryEnd = historyIndex === profile.history.length - 1;
	profile.history.splice(historyIndex + 1);
	const description = getHistoryDescription(previous, snapshot, true);
	const now = new Date();
	const lastEntry = profile.history[profile.history.length - 1];
	const baseSnapshot = profile.history.length >= 2 ? profile.history[profile.history.length - 2].snapshot : null;
	if (wasAtHistoryEnd && lastEntry && lastEntry.label === description.label && now.getTime() - new Date(lastEntry.timestamp).getTime() < 750) {
		const coalescedDesc = baseSnapshot ? getHistoryDescription(baseSnapshot, snapshot, true) : description;
		lastEntry.label = coalescedDesc.label;
		lastEntry.detail = coalescedDesc.detail;
		lastEntry.timestamp = now.toISOString();
		lastEntry.snapshot = snapshot;
	} else {
		profile.history.push({
			label: description.label,
			detail: description.detail,
			timestamp: now.toISOString(),
			snapshot
		});
	}
	if (profile.history.length > PROFILE_HISTORY_LIMIT) {
		profile.history.splice(0, profile.history.length - PROFILE_HISTORY_LIMIT);
	}
	profile.historyIndex = profile.history.length - 1;
	Object.assign(profile, snapshot);

	renderProfileHistory();
	updateProfileActionLabels();
	setProfileHistoryStatus('Unsaved changes. Save Changes to keep them.');
}

function applyProfileSnapshot(snapshot) {
	if (!snapshot || !snapshot.ruleTree || snapshot.ruleTree.type !== 'group') {
		setProfileHistoryStatus('Cannot restore an invalid history entry.', true);
		return false;
	}
	const previousUser = state.selectedUser;
	state.ruleTree = JSON.parse(JSON.stringify(snapshot.ruleTree));
	state.searchMode = snapshot.searchMode || 'random';
	state.selectedUser = snapshot.user || '';
	state.sampleSize = snapshot.limit || 24;
	state.orderByField = snapshot.orderByField || 'localDateTime';
	state.orderByDirection = snapshot.orderByDirection || 'desc';
	state.includeVideos = snapshot.includeVideos !== false;
	state.includeArchived = !!snapshot.includeArchived;

	const accountSelect = document.getElementById('account-select');
	if (accountSelect) accountSelect.value = state.selectedUser;
	updateAccountSwitcherLabel();
	renderAccountMenu();
	syncToolbarControls();
	renderRuleTree();
	syncFromRuleTree();
	if (previousUser !== state.selectedUser) {
		fetchMetadataForUser(state.selectedUser, false);
	}
	return true;
}

function restoreProfileHistory(index) {
	const ctx = getActiveHistoryContext();
	const history = ctx.isProfile ? ctx.target.history : ctx.target.entries;
	if (!Array.isArray(history) || !history[index]) return;

	profileHistoryApplying = true;
	let restored = false;
	try {
		restored = applyProfileSnapshot(history[index].snapshot);
	} finally {
		profileHistoryApplying = false;
	}
	if (!restored) return;
	if (ctx.isProfile) {
		ctx.target.historyIndex = index;
		Object.assign(ctx.target, getProfileSnapshot());
		renderProfileHistory();
		updateProfileActionLabels();
		setProfileHistoryStatus(isActiveProfileDirty() ? 'Unsaved changes. Save Changes to keep them.' : 'No unsaved changes.');
	} else {
		ctx.target.index = index;
		renderProfileHistory();
		setProfileHistoryStatus('Restored session step (custom filter).');
	}
}

function undoProfileHistory() {
	const ctx = getActiveHistoryContext();
	const history = ctx.isProfile ? ctx.target.history : ctx.target.entries;
	const idx = ctx.isProfile ? (ctx.target.historyIndex || 0) : (ctx.target.index || 0);
	if (Array.isArray(history) && idx > 0) {
		restoreProfileHistory(idx - 1);
	}
}

function redoProfileHistory() {
	const ctx = getActiveHistoryContext();
	const history = ctx.isProfile ? ctx.target.history : ctx.target.entries;
	const idx = ctx.isProfile ? (ctx.target.historyIndex || 0) : (ctx.target.index || 0);
	if (Array.isArray(history) && idx < history.length - 1) {
		restoreProfileHistory(idx + 1);
	}
}

function applyProfile(profileId) {
	state.activeProfileId = profileId;
	updateProfileActionLabels();
	const deleteBtn = document.getElementById('btn-delete-profile');
	const selectEl = document.getElementById('profile-select');
	if (selectEl) selectEl.value = profileId;

	if (deleteBtn) {
		deleteBtn.hidden = !(profileId && profileId.startsWith('prof_'));
	}

	if (!profileId) {
		updateCodeViewers(compileGroupToAST(state.ruleTree), true);
		renderProfileHistory();
		updateProfileActionLabels();
		return;
	}

	// Load custom saved profile
	const prof = state.profiles.find(p => p.id === profileId);
	if (prof) {
		const previousUser = state.selectedUser;
		profileHistoryApplying = true;
		try {
			if (prof.ruleTree && typeof prof.ruleTree === 'object') {
				state.ruleTree = JSON.parse(JSON.stringify(prof.ruleTree));
			} else if (prof.filterJson) {
				try {
					const ast = JSON.parse(prof.filterJson);
					const group = astToRuleGroup(ast);
					if (group) state.ruleTree = group;
				} catch (e) {
					console.warn('Error parsing profile filterJson:', e);
				}
			}

			if (prof.searchMode) state.searchMode = prof.searchMode;
			if (prof.orderByField) state.orderByField = prof.orderByField;
			if (prof.orderByDirection) state.orderByDirection = prof.orderByDirection;
			if (prof.limit && prof.limit > 0) state.sampleSize = prof.limit;
			if (prof.includeVideos !== undefined) state.includeVideos = !!prof.includeVideos;
			if (prof.includeArchived !== undefined) state.includeArchived = !!prof.includeArchived;
			if (prof.user !== undefined) {
				state.selectedUser = prof.user;
				const accSelect = document.getElementById('account-select');
				if (accSelect) accSelect.value = prof.user;
				updateAccountSwitcherLabel();
				renderAccountMenu();
			}

			syncToolbarControls();
			renderRuleTree();
			syncFromRuleTree();
			if (previousUser !== state.selectedUser) {
				fetchMetadataForUser(state.selectedUser, false);
			}
		} finally {
			profileHistoryApplying = false;
		}

		const initializedHistory = !Array.isArray(prof.history) || prof.history.length === 0;
		if (initializedHistory) {
			prof.history = [{
				label: 'Profile saved',
				detail: '',
				timestamp: prof.updatedAt || new Date().toISOString(),
				snapshot: getProfileSnapshot()
			}];
			prof.historyIndex = 0;
		} else {
			prof.historyIndex = Math.max(0, Math.min(prof.historyIndex || 0, prof.history.length - 1));
		}
		savedProfileSnapshots.set(prof.id, JSON.stringify(prof));
		renderProfileHistory();
		updateProfileActionLabels();
		setProfileHistoryStatus(prof.pendingSync
			? 'This profile is saved in this browser only. Use Sync to Server when available.'
			: 'Changes are drafts until you save this profile.');
	}
}

function openSaveProfileModal(asCopy = false) {
	const dialog = document.getElementById('save-profile-dialog');
	const nameInput = document.getElementById('save-profile-name');
	if (!dialog || !nameInput) return;
	saveProfileAsCopy = asCopy;

	let currentName = '';
	if (state.activeProfileId && state.activeProfileId.startsWith('prof_')) {
		const cur = state.profiles.find(p => p.id === state.activeProfileId);
		if (cur) currentName = cur.name;
	}
	nameInput.value = asCopy ? (currentName ? `${currentName} copy` : '') : currentName;
	const dialogTitle = document.getElementById('save-profile-dialog-title');
	const confirmButton = document.getElementById('btn-confirm-save-profile');
	if (dialogTitle) {
		dialogTitle.textContent = asCopy
			? '⧉ Save Profile as Copy'
			: (state.activeProfileId ? '✏️ Rename Profile' : '💾 Save Search Profile');
	}
	if (confirmButton) {
		confirmButton.disabled = false;
		confirmButton.textContent = asCopy
			? 'Save Copy'
			: (state.activeProfileId ? 'Rename Profile' : 'Save Profile');
	}

	const modeEl = document.getElementById('profile-summary-mode');
	const userEl = document.getElementById('profile-summary-user');
	const togglesEl = document.getElementById('profile-summary-toggles');

	if (modeEl) modeEl.textContent = `⚡ Mode: ${state.searchMode === 'metadata' ? 'Sorted Timeline' : 'Random Sample'}` + (state.searchMode === 'metadata' ? ` (${state.orderByField} ${state.orderByDirection.toUpperCase()})` : '');
	if (userEl) userEl.textContent = `👤 Account: ${state.selectedUser ? `@${state.selectedUser}` : 'All Accounts'}`;
	if (togglesEl) togglesEl.textContent = `🎬 Videos: ${state.includeVideos ? 'Included' : 'Excluded'}, Archived: ${state.includeArchived ? 'Included' : 'Excluded'}, Sample: ${state.sampleSize}`;

	dialog.showModal();
	setTimeout(() => nameInput.focus(), 50);
}

async function handleSaveProfileSubmit(e) {
	e.preventDefault();
	const nameInput = document.getElementById('save-profile-name');
	const dialog = document.getElementById('save-profile-dialog');
	const confirmButton = document.getElementById('btn-confirm-save-profile');
	const name = nameInput ? nameInput.value.trim() : '';
	if (!name) return;

	const snapshot = getProfileSnapshot();
	const sourceProfileId = saveProfileAsCopy ? state.activeProfileId : '';
	const id = !saveProfileAsCopy && state.activeProfileId && state.activeProfileId.startsWith('prof_')
		? state.activeProfileId
		: '';
	const existingProfile = state.profiles.find(p => p.id === id);
	const copiedFrom = saveProfileAsCopy
		? (state.profiles.find(p => p.id === state.activeProfileId) || {}).name
		: '';
	const profileData = {
		id: id,
		name: name,
		filterJson: snapshot.filterJson,
		ruleTree: snapshot.ruleTree,
		searchMode: state.searchMode,
		user: state.selectedUser,
		limit: state.sampleSize,
		orderByField: state.orderByField,
		orderByDirection: state.orderByDirection,
		includeVideos: state.includeVideos,
		includeArchived: state.includeArchived,
		createdAt: existingProfile && existingProfile.createdAt ? existingProfile.createdAt : undefined,
		updatedAt: new Date().toISOString(),
		history: (existingProfile || {}).history || [{
			label: copiedFrom ? `Copied from ${copiedFrom}` : 'Profile saved',
			detail: '',
			timestamp: new Date().toISOString(),
			snapshot
		}],
		historyIndex: (existingProfile || {}).historyIndex || 0
	};

	if (confirmButton) confirmButton.disabled = true;
	let savedToServer = false;
	try {
		try {
			const resp = await fetch('/api/profiles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(profileData)
			});
			if (!resp.ok) throw new Error(`Profile save failed (${resp.status})`);
			const data = await resp.json();
			if (!data.profile || !data.profile.id) throw new Error('Profile save response did not include an ID');
			profileData.id = data.profile.id;
			profileData.createdAt = data.profile.createdAt || profileData.createdAt;
			profileData.updatedAt = data.profile.updatedAt || profileData.updatedAt;
			savedToServer = true;
		} catch (err) {
			console.warn('Saving profile to server failed:', err);
			if (!profileData.id) {
				profileData.id = 'prof_' + Date.now();
			}
		}
		if (savedToServer) {
			delete profileData.pendingSync;
			profileData.serverBacked = true;
		} else {
			profileData.pendingSync = true;
			if (existingProfile && existingProfile.serverBacked) profileData.serverBacked = true;
		}

		const nextProfiles = [...state.profiles];
		if (sourceProfileId && isProfileDirty(sourceProfileId)) {
			const sourceSnapshot = savedProfileSnapshots.get(sourceProfileId);
			const sourceIndex = nextProfiles.findIndex(p => p.id === sourceProfileId);
			if (sourceIndex >= 0) {
				if (sourceSnapshot === undefined) nextProfiles.splice(sourceIndex, 1);
				else nextProfiles[sourceIndex] = JSON.parse(sourceSnapshot);
			}
		}

		const idx = nextProfiles.findIndex(p => p.id === profileData.id);
		if (idx >= 0) {
			nextProfiles[idx] = profileData;
		} else {
			nextProfiles.push(profileData);
		}

		const savedLocally = saveProfilesToLocalStorage(nextProfiles);
		if (!savedToServer && !savedLocally) {
			setProfileHistoryStatus('Could not save the profile. Check the server or browser storage and try again.', true);
			return;
		}

		state.profiles = nextProfiles;
		savedProfileSnapshots.set(profileData.id, JSON.stringify(profileData));
		state.activeProfileId = profileData.id;
		saveProfileAsCopy = false;
		if (dialog) dialog.close();
		renderProfilesDropdown();
		renderProfileHistory();
		setProfileHistoryStatus(
			savedToServer ? 'Saved to server profile storage.' : 'Saved in this browser only; server save failed.',
			!savedToServer
		);
	} finally {
		if (confirmButton) confirmButton.disabled = false;
	}
}

async function handleDeleteProfile() {
	if (!state.activeProfileId || !state.activeProfileId.startsWith('prof_')) return;
	const idToDelete = state.activeProfileId;
	const profile = state.profiles.find(p => p.id === idToDelete);
	if (!profile) return;
	const name = profile.name || 'this profile';
	const dirtyNotice = isProfileDirty(idToDelete) ? ' Any unsaved changes will also be lost.' : '';
	if (!confirm(`Are you sure you want to delete profile "${name}"?${dirtyNotice}`)) {
		return;
	}

	const remainingProfiles = state.profiles.filter(p => p.id !== idToDelete);
	const serverBacked = !!profile.serverBacked || !profile.pendingSync;
	if (!serverBacked) {
		if (!saveProfilesToLocalStorage(remainingProfiles)) {
			setProfileHistoryStatus('Could not delete the browser-only profile from local storage.', true);
			return;
		}
		state.profiles = remainingProfiles;
		savedProfileSnapshots.delete(idToDelete);
		state.activeProfileId = '';
		renderProfilesDropdown();
		renderProfileHistory();
		setProfileHistoryStatus('Profile deleted from this browser.');
		return;
	}

	const profilesWithDeletionMarker = state.profiles.map(item =>
		item.id === idToDelete ? { ...item, deletePending: true } : item
	);
	saveProfilesToLocalStorage(profilesWithDeletionMarker);

	try {
		const response = await fetch(`/api/profiles/${encodeURIComponent(idToDelete)}`, {
			method: 'DELETE'
		});
		if (!response.ok) throw new Error(`Profile deletion failed (${response.status})`);
	} catch (err) {
		console.warn('Could not delete profile from server:', err);
		const restoredLocally = saveProfilesToLocalStorage();
		setProfileHistoryStatus(
			restoredLocally
				? 'Could not delete the profile from server storage.'
				: 'Could not delete the profile, and its browser storage state could not be restored.',
			true
		);
		return;
	}

	state.profiles = remainingProfiles;
	savedProfileSnapshots.delete(idToDelete);
	const savedLocally = saveProfilesToLocalStorage();
	state.activeProfileId = '';
	renderProfilesDropdown();
	renderProfileHistory();
	setProfileHistoryStatus(savedLocally ? 'Profile deleted.' : 'Profile deleted from server.', !savedLocally);
}

function hasPendingProfileSave() {
	const dialog = document.getElementById('save-profile-dialog');
	if (!dialog || !dialog.open) return false;
	if (saveProfileAsCopy) return true;

	const nameInput = document.getElementById('save-profile-name');
	const name = nameInput ? nameInput.value.trim() : '';
	if (!name) return false;
	const profile = state.profiles.find(item => item.id === state.activeProfileId);
	return !profile || profile.name !== name;
}

function applyTheme(theme, persist = true) {
	const normalized = (theme === 'light' || theme === 'dark') ? theme : 'auto';
	const meta = document.querySelector('meta[name="color-scheme"]');
	document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === normalized));
	if (normalized === 'auto') {
		document.documentElement.removeAttribute('data-theme');
		if (meta) meta.content = 'light dark';
		if (persist) {
			try { localStorage.removeItem('color-scheme'); } catch (_) {}
		}
	} else {
		document.documentElement.setAttribute('data-theme', normalized);
		if (meta) meta.content = normalized;
		if (persist) {
			try { localStorage.setItem('color-scheme', normalized); } catch (_) {}
		}
	}
}

document.addEventListener('DOMContentLoaded', () => {
	setupDialogLightDismissFallback();
	let initialTheme = 'auto';
	try {
		const savedTheme = localStorage.getItem('color-scheme');
		if (savedTheme === 'light' || savedTheme === 'dark') initialTheme = savedTheme;
	} catch (_) {}
	applyTheme(initialTheme, false);
	window.addEventListener('storage', (event) => {
		if (event.key === 'color-scheme') {
			applyTheme(event.newValue || 'auto', false);
		}
	});
	bootstrapApp();
	window.addEventListener('beforeunload', event => {
		if (!isActiveProfileDirty() && !hasPendingProfileSave()) return;
		event.preventDefault();
		event.returnValue = '';
	});

	const unsavedProfileDialog = document.getElementById('unsaved-profile-dialog');
	if (unsavedProfileDialog) {
		unsavedProfileDialog.querySelectorAll('[data-unsaved-action]').forEach(button => {
			button.addEventListener('click', () => finishUnsavedProfilePrompt(button.dataset.unsavedAction));
		});
		unsavedProfileDialog.addEventListener('close', () => finishUnsavedProfilePrompt('cancel'));
	}

	document.addEventListener('keydown', (event) => {
		const assetDialog = document.getElementById('asset-dialog');
		if (assetDialog && assetDialog.open && !event.ctrlKey && !event.metaKey && !event.altKey) {
			if (event.key === 'ArrowLeft' && state.lightboxIndex > 0) {
				event.preventDefault();
				openAssetModal(state.lightboxIndex - 1);
				return;
			}
			if (event.key === 'ArrowRight' && state.lightboxIndex >= 0 && state.lightboxIndex < state.lastAssets.length - 1) {
				event.preventDefault();
				openAssetModal(state.lightboxIndex + 1);
				return;
			}
		}

		if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
		if (event.key.toLowerCase() === 's') {
			event.preventDefault();
			const activeProf = state.profiles.find(item => item.id === state.activeProfileId);
			if (state.activeProfileId && (isActiveProfileDirty() || (activeProf && activeProf.pendingSync))) {
				saveActiveProfile();
			} else {
				openSaveProfileModal(false);
			}
			return;
		}
		const target = event.target;
		if (target instanceof Element && target.matches('input, textarea, select, [contenteditable="true"]')) return;
		const ctx = getActiveHistoryContext();
		const history = ctx.isProfile ? ctx.target.history : ctx.target.entries;
		if (!Array.isArray(history) || history.length < 2) return;
		if (event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) redoProfileHistory();
			else undoProfileHistory();
		} else if (event.key.toLowerCase() === 'y') {
			event.preventDefault();
			redoProfileHistory();
		}
	});

	// Close dropdowns when clicking outside value box
	document.addEventListener('click', (e) => {
		if (e.target && (e.target.closest('.rt-value-box') || e.target.closest('.rt-dropdown-item'))) {
			return;
		}
		document.querySelectorAll('.rt-dropdown-menu.open').forEach(el => el.classList.remove('open'));
	});

	// Delegated events for rule tree chips & dropdown options
	const ruleTreeMount = document.getElementById('rule-tree-mount');
	if (ruleTreeMount) {
		ruleTreeMount.addEventListener('click', (e) => {
			const chipX = e.target.closest('[data-action="remove-chip"]');
			if (chipX) {
				rtRemoveMultiValue(chipX.dataset.ruleId, chipX.dataset.value, e);
				return;
			}
			const ddItem = e.target.closest('[data-action="toggle-opt"]');
			if (ddItem) {
				rtToggleMultiValue(ddItem.dataset.ruleId, ddItem.dataset.value, e);
				return;
			}
			const ddWrap = e.target.closest('[data-action="open-dd"]');
			if (ddWrap) {
				rtOpenDropdown(ddWrap.dataset.ruleId, e);
			}
		});
	}

	// Delegated account filtering on asset grid & asset dialog
	const assetsGrid = document.getElementById('assets-grid');
	if (assetsGrid) {
		assetsGrid.addEventListener('click', (e) => {
			const accountBtn = e.target.closest('[data-filter-account]');
			if (accountBtn) {
				e.stopPropagation();
				filterByAccount(accountBtn.dataset.filterAccount);
			}
		});
	}

	const assetDialogBody = document.getElementById('asset-dialog-body');
	if (assetDialogBody) {
		assetDialogBody.addEventListener('click', (e) => {
			const accountBtn = e.target.closest('[data-filter-account]');
			if (accountBtn) {
				const d = document.getElementById('asset-dialog');
				if (d) d.close();
				filterByAccount(accountBtn.dataset.filterAccount);
				return;
			}
			const quickBtn = e.target.closest('[data-quick-field]');
			if (quickBtn) {
				addQuickFilterFromAsset(quickBtn.dataset.quickField, quickBtn.dataset.quickValue);
			}
		});
	}

	const lightboxPrevBtn = document.getElementById('btn-lightbox-prev');
	if (lightboxPrevBtn) {
		lightboxPrevBtn.addEventListener('click', () => {
			if (state.lightboxIndex > 0) openAssetModal(state.lightboxIndex - 1);
		});
	}

	const lightboxNextBtn = document.getElementById('btn-lightbox-next');
	if (lightboxNextBtn) {
		lightboxNextBtn.addEventListener('click', () => {
			if (state.lightboxIndex >= 0 && state.lightboxIndex < state.lastAssets.length - 1) {
				openAssetModal(state.lightboxIndex + 1);
			}
		});
	}

	// Delegated account selection in topbar account menu
	const accountMenuPopover = document.getElementById('account-menu-popover');
	if (accountMenuPopover) {
		accountMenuPopover.addEventListener('click', (e) => {
			const itemBtn = e.target.closest('[data-select-account]');
			if (itemBtn) {
				selectAccount(itemBtn.dataset.selectAccount || '');
			}
		});
	}

	// Theme switcher
	document.querySelectorAll('.theme-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			applyTheme(btn.dataset.theme, true);
		});
	});

	// Connection status dialog trigger
	const connStatusBtn = document.getElementById('connection-status');
	if (connStatusBtn) {
		connStatusBtn.addEventListener('click', () => openConnectionDialog());
	}

	// Account dropdown switcher button trigger
	const accountSwitcherBtn = document.getElementById('account-switcher-btn');
	if (accountSwitcherBtn) {
		accountSwitcherBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			toggleAccountMenu();
		});
	}

	// Close account menu popover when clicking outside
	document.addEventListener('click', (e) => {
		const wrap = document.getElementById('account-dropdown-wrap');
		if (wrap && !wrap.contains(e.target)) {
			closeAccountMenu();
		}
	});

	// Account change (from hidden native select or sync)
	const accountSelect = document.getElementById('account-select');
	if (accountSelect) {
		accountSelect.addEventListener('change', () => {
			selectAccount(accountSelect.value);
		});
	}

	// Refresh metadata button
	const refreshBtn = document.getElementById('btn-refresh-meta');
	if (refreshBtn) {
		refreshBtn.addEventListener('click', async () => {
			refreshBtn.disabled = true;
			const origText = refreshBtn.innerHTML;
			refreshBtn.innerHTML = '<span>↻ Loading...</span>';
			try {
				await fetchMetadataForUser(state.selectedUser, true);
			} finally {
				refreshBtn.disabled = false;
				refreshBtn.innerHTML = origText;
			}
		});
	}

	// Search Profiles
	const profileSelect = document.getElementById('profile-select');
	if (profileSelect) {
		profileSelect.addEventListener('change', (e) => handleProfileSelection(e.target.value));
	}

	const saveProfileBtn = document.getElementById('btn-save-profile');
	if (saveProfileBtn) {
		saveProfileBtn.addEventListener('click', () => {
			const profile = state.profiles.find(item => item.id === state.activeProfileId);
			if (isActiveProfileDirty() || (profile && profile.pendingSync)) saveActiveProfile();
			else openSaveProfileModal();
		});
	}

	const copyProfileBtn = document.getElementById('btn-copy-profile');
	if (copyProfileBtn) {
		copyProfileBtn.addEventListener('click', () => openSaveProfileModal(true));
	}

	const deleteProfileBtn = document.getElementById('btn-delete-profile');
	if (deleteProfileBtn) {
		deleteProfileBtn.addEventListener('click', () => handleDeleteProfile());
	}

	const discardProfileBtn = document.getElementById('btn-discard-profile');
	if (discardProfileBtn) {
		discardProfileBtn.addEventListener('click', () => {
			discardActiveProfileChanges();
		});
	}

	const clearFilterBtn = document.getElementById('btn-clear-filter');
	if (clearFilterBtn) {
		clearFilterBtn.addEventListener('click', () => {
			state.ruleTree = { id: 'root', type: 'group', combiner: 'AND', children: [] };
			renderRuleTree();
			syncFromRuleTree();
		});
	}

	const undoProfileBtn = document.getElementById('btn-undo-profile');
	if (undoProfileBtn) {
		undoProfileBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			undoProfileHistory();
		});
	}

	const redoProfileBtn = document.getElementById('btn-redo-profile');
	if (redoProfileBtn) {
		redoProfileBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			redoProfileHistory();
		});
	}

	const saveProfileForm = document.getElementById('save-profile-form');
	if (saveProfileForm) {
		saveProfileForm.addEventListener('submit', handleSaveProfileSubmit);
	}

	const cancelSaveProfileBtn = document.getElementById('btn-cancel-save-profile');
	if (cancelSaveProfileBtn) {
		cancelSaveProfileBtn.addEventListener('click', () => {
			saveProfileAsCopy = false;
			const dialog = document.getElementById('save-profile-dialog');
			if (dialog) dialog.close();
		});
	}
	const saveProfileDialog = document.getElementById('save-profile-dialog');
	if (saveProfileDialog) {
		saveProfileDialog.addEventListener('close', () => { saveProfileAsCopy = false; });
	}

	// Code Tabs (Filter JSON / Request Body / cURL)
	document.querySelectorAll('.json-tab-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			const tab = btn.dataset.codeTab;
			state.activeCodeTab = tab;
			document.querySelectorAll('.json-tab-btn').forEach(b => {
				const isSelected = b.dataset.codeTab === tab;
				b.classList.toggle('active', isSelected);
				b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
			});
			document.getElementById('code-pane-filter').hidden = (tab !== 'filter');
			document.getElementById('code-pane-request').hidden = (tab !== 'request');
			document.getElementById('code-pane-curl').hidden = (tab !== 'curl');
		});
	});

	// Filter JSON Editor events
	const jsonEditor = document.getElementById('filter-json-editor');
	if (jsonEditor) {
		jsonEditor.addEventListener('input', () => {
			const text = jsonEditor.value.trim();
			if (!text || text === '{}') {
				setJsonSyncStatus('dirty', '✏️ Edited — click Apply to Tree');
				return;
			}
			try {
				const parsed = JSON.parse(text);
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					setJsonSyncStatus('error', '⚠️ Must be a JSON object');
				} else {
					setJsonSyncStatus('dirty', '✏️ Valid JSON — click Apply to Tree');
				}
			} catch (err) {
				const msg = (err && err.message ? err.message : 'Syntax Error').split('\n')[0];
				setJsonSyncStatus('error', `⚠️ ${msg}`);
			}
		});

		jsonEditor.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
				e.preventDefault();
				applyJsonEditorToTree();
			}
		});
	}

	const applyBtn = document.getElementById('btn-apply-json');
	if (applyBtn) {
		applyBtn.addEventListener('click', applyJsonEditorToTree);
	}

	const formatBtn = document.getElementById('btn-format-json');
	if (formatBtn && jsonEditor) {
		formatBtn.addEventListener('click', () => {
			try {
				const parsed = JSON.parse(jsonEditor.value || '{}');
				jsonEditor.value = JSON.stringify(parsed, null, 2);
			} catch (err) {
				setJsonSyncStatus('error', '⚠️ Cannot format invalid JSON');
			}
		});
	}

	const copyBtn = document.getElementById('btn-copy-code');
	if (copyBtn) {
		copyBtn.addEventListener('click', () => {
			let targetId = 'filter-json-editor';
			if (state.activeCodeTab === 'request') targetId = 'request-body-viewer';
			if (state.activeCodeTab === 'curl') targetId = 'curl-viewer';
			const el = document.getElementById(targetId);
			if (!el || !navigator.clipboard) return;
			navigator.clipboard.writeText(el.value).then(() => {
				const orig = copyBtn.textContent;
				copyBtn.textContent = '✓ Copied!';
				setTimeout(() => { copyBtn.textContent = orig; }, 1600);
			});
		});
	}

	// Search Mode (Random vs Metadata)
	document.querySelectorAll('.seg-btn[data-search-mode], .mode-toggle-btn[data-search-mode]').forEach(btn => {
		btn.addEventListener('click', () => {
			if (btn.dataset.searchMode === state.searchMode) return;
			state.searchMode = btn.dataset.searchMode;
			syncToolbarControls();
			syncFromRuleTree();
		});
	});

	// Reshuffle button
	const reshuffleBtn = document.getElementById('btn-reshuffle');
	if (reshuffleBtn) {
		reshuffleBtn.addEventListener('click', () => {
			runLiveSearch();
		});
	}

	// Metadata Sort
	const sortSelect = document.getElementById('metadata-sort-select');
	if (sortSelect) {
		sortSelect.addEventListener('change', () => {
			const [field, dir] = sortSelect.value.split(':');
			state.orderByField = field || 'localDateTime';
			state.orderByDirection = dir || 'desc';
			recordProfileHistory();
			runLiveSearch();
		});
	}

	// Video & Archived toggles
	const vidToggle = document.getElementById('toggle-include-videos');
	if (vidToggle) {
		vidToggle.addEventListener('change', () => {
			state.includeVideos = vidToggle.checked;
			recordProfileHistory();
			runLiveSearch();
		});
	}

	const archToggle = document.getElementById('toggle-include-archived');
	if (archToggle) {
		archToggle.addEventListener('change', () => {
			state.includeArchived = archToggle.checked;
			recordProfileHistory();
			runLiveSearch();
		});
	}

	// Sample size pills
	document.querySelectorAll('.limit-pill').forEach(btn => {
		btn.addEventListener('click', () => {
			state.sampleSize = parseInt(btn.dataset.limit, 10) || 24;
			syncToolbarControls();
			recordProfileHistory();
			runLiveSearch();
		});
	});

	// Load More button
	const loadMoreBtn = document.getElementById('btn-load-more');
	if (loadMoreBtn) {
		loadMoreBtn.addEventListener('click', () => {
			if (state.sampleSize < 48) state.sampleSize = 48;
			else if (state.sampleSize < 96) state.sampleSize = 96;
			else if (state.sampleSize < 144) state.sampleSize = 144;
			else state.sampleSize = 200;
			syncToolbarControls();
			runLiveSearch();
		});
	}
});

