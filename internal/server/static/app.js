// ==========================================================================
// Immich Filter Playground — Client Application
// ==========================================================================

const state = {
	immichUrl: '',
	externalUrl: '',
	accounts: [],
	selectedUser: '',
	searchMode: 'random',
	orderByField: 'takenAt',
	orderByDirection: 'desc',
	sampleSize: 24,
	includeVideos: true,
	includeArchived: false,
	activeCodeTab: 'filter',
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
	ruleTree: {
		id: 'root',
		type: 'group',
		combiner: 'AND',
		children: []
	}
};

let searchDebounceTimer = null;
let activeSearchController = null;

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
	}
	renderRuleTree();
	syncFromRuleTree();
};

window.rtToggleMultiValue = function(ruleId, val) {
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

window.rtHandleChipKeydown = function(ruleId, e) {
	if (e.key === 'Enter') {
		e.preventDefault();
		const val = (e.target.value || '').trim();
		if (!val) return;
		const rule = findNode(state.ruleTree, ruleId);
		if (!rule) return;
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
		const txt = item.textContent.toLowerCase();
		const matches = txt.includes(q);
		item.style.display = matches ? 'flex' : 'none';
		if (matches) visibleCount++;
	});
	let noMatch = dd.querySelector('.rt-no-match');
	if (visibleCount === 0) {
		if (!noMatch) {
			noMatch = document.createElement('div');
			noMatch.className = 'rt-no-match';
			noMatch.style.cssText = 'padding: 0.5rem 0.65rem; color: var(--text-muted); font-size: 0.75rem;';
			noMatch.textContent = 'Press Enter to add custom value';
			dd.appendChild(noMatch);
		}
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
					<span class="rt-chip-x" onclick="rtRemoveMultiValue('${escapeJsString(rule.id)}', '${escapeJsString(val)}', event)">✕</span>
				</span>
			`;
		}

		let dropdownItems = '';
		for (const opt of available) {
			const isSel = selectedVals.includes(opt.value);
			dropdownItems += `
				<div class="rt-dropdown-item ${isSel ? 'selected' : ''}" onclick="rtToggleMultiValue('${escapeJsString(rule.id)}', '${escapeJsString(opt.value)}')">
					<span>${escapeHtml(opt.label)}</span>
					${isSel ? '<span>✓</span>' : ''}
				</div>
			`;
		}

		valueBox += `
			<div class="rt-chips-container" onclick="rtOpenDropdown('${escapeJsString(rule.id)}', event)">
				${chips}
				<input
					type="text"
					class="rt-chip-input"
					placeholder="${selectedVals.length ? '' : 'Search or type + Enter...'}"
					onfocus="rtOpenDropdown('${escapeJsString(rule.id)}', event)"
					oninput="rtFilterDropdown('${escapeJsString(rule.id)}', this.value)"
					onkeydown="rtHandleChipKeydown('${escapeJsString(rule.id)}', event)"
				>
			</div>
			<div class="rt-dropdown-menu scroller" id="dropdown_${escapeJsString(rule.id)}">
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
		const curRating = parseInt(rule.value, 10) || 3;
		valueBox += `<select class="rt-select-field" style="width: 100%;" onchange="rtSetScalarValue('${rule.id}', parseInt(this.value, 10))">`;
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
			<button type="button" class="rt-btn-del" onclick="rtDeleteNode('${rule.id}')" title="Delete condition">✕</button>
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
		if (!rule.dateAfter && !rule.dateBefore) return null;
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
			branch.rating = { [op]: parseInt(value, 10) || 3 };
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
			if (rule.dateAfter) branch.takenAt.gte = rule.dateAfter;
			if (rule.dateBefore) branch.takenAt.lte = rule.dateBefore;
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
						const merged = Object.assign({}, direct, orBranch);
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
	const root = {};
	let orBranches = [];

	for (const child of group.children) {
		if (child.type === 'rule') {
			const b = compileRuleToBranch(child);
			if (b && Object.keys(b).length > 0) Object.assign(root, b);
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
								combined.push(Object.assign({}, b1, b2));
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
								combined.push(Object.assign({}, b1, b2));
							}
						}
						orBranches = combined;
					}
					delete subAnd.or;
				}
				if (Object.keys(subAnd).length > 0) {
					Object.assign(root, subAnd);
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
	if (key === 'personIds') {
		const op = val.all ? 'all' : (val.none ? 'none' : 'any');
		const list = Array.isArray(val) ? val : (val[op] || []);
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'people', operator: op, value: list });
	} else if (key === 'albumIds') {
		const op = val.all ? 'all' : (val.none ? 'none' : 'any');
		const list = Array.isArray(val) ? val : (val[op] || []);
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'albums', operator: op, value: list });
	} else if (key === 'tagIds') {
		const op = val.all ? 'all' : (val.none ? 'none' : 'any');
		const list = Array.isArray(val) ? val : (val[op] || []);
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'tags', operator: op, value: list });
	} else if (['country', 'state', 'city'].includes(key)) {
		if (typeof val === 'string') {
			children.push({ id: generateNodeId('r'), type: 'rule', field: key, operator: 'eq', value: [val] });
		} else if (Array.isArray(val)) {
			children.push({ id: generateNodeId('r'), type: 'rule', field: key, operator: 'in', value: val });
		} else {
			const op = val.eq ? 'eq' : (val.notIn ? 'notIn' : 'in');
			const v = val.eq ? [val.eq] : (val[op] || []);
			children.push({ id: generateNodeId('r'), type: 'rule', field: key, operator: op, value: v });
		}
	} else if (key === 'model') {
		const op = val.eq ? 'eq' : (val.notIn ? 'notIn' : 'in');
		const v = typeof val === 'string' ? [val] : (val.eq ? [val.eq] : (val[op] || []));
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'camera', operator: op, value: v });
	} else if (key === 'make') {
		const op = val.eq ? 'eq' : (val.notIn ? 'notIn' : 'in');
		const v = typeof val === 'string' ? [val] : (val.eq ? [val.eq] : (val[op] || []));
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'make', operator: op, value: v });
	} else if (key === 'lensModel') {
		const op = val.eq ? 'eq' : (val.notIn ? 'notIn' : 'in');
		const v = typeof val === 'string' ? [val] : (val.eq ? [val.eq] : (val[op] || []));
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'lens', operator: op, value: v });
	} else if (key === 'isFavorite') {
		const boolVal = typeof val === 'boolean' ? val : !!val.eq;
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'favorite', operator: boolVal ? 'true' : 'false', value: boolVal });
	} else if (key === 'isMotion') {
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'media_type', operator: 'MOTION', value: 'MOTION' });
	} else if (key === 'type') {
		const t = typeof val === 'string' ? val : (val.in ? val.in[0] : (val.eq || 'IMAGE'));
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'media_type', operator: t, value: t });
	} else if (key === 'visibility') {
		const vis = typeof val === 'string' ? val : (val.in ? val.in[0] : (val.eq || 'timeline'));
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'visibility', operator: vis, value: vis });
	} else if (key === 'rating') {
		if (typeof val === 'number') {
			children.push({ id: generateNodeId('r'), type: 'rule', field: 'rating', operator: 'eq', value: val });
		} else {
			const op = val.eq !== undefined ? 'eq' : (val.lte !== undefined ? 'lte' : 'gte');
			const num = val[op] || 3;
			children.push({ id: generateNodeId('r'), type: 'rule', field: 'rating', operator: op, value: num });
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
	} else if (key === 'description') {
		const op = Object.keys(val)[0] || 'like';
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'description', operator: op, value: val[op] || '' });
	} else if (key === 'originalFileName') {
		const op = Object.keys(val)[0] || 'like';
		children.push({ id: generateNodeId('r'), type: 'rule', field: 'filename', operator: op, value: val[op] || '' });
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
		curlViewer.value = [
			`curl -X POST "${baseUrl}${endpoint}" \\`,
			`  -H "Content-Type: application/json" \\`,
			`  -H "x-api-key: $IMMICH_API_KEY" \\`,
			`  -d '${bodyCompact.replace(/'/g, "'\\''")}'`
		].join('\n');
	}
}

function syncFromRuleTree(opts = {}) {
	const ast = compileGroupToAST(state.ruleTree);
	updateCodeViewers(ast, opts.skipFilterEditor);
	scheduleLiveSearch(JSON.stringify(ast));
}

function scheduleLiveSearch(filterJsonStr) {
	if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
	searchDebounceTimer = setTimeout(() => {
		runLiveSearch(filterJsonStr);
	}, 180);
}

async function runLiveSearch(filterJsonStr) {
	if (activeSearchController) {
		activeSearchController.abort();
	}
	activeSearchController = new AbortController();

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
		renderSearchResults(data);
	} catch (err) {
		if (err.name === 'AbortError') return;
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
		loadMoreWrap.hidden = !(total > assets.length && state.sampleSize < 240);
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
							${item.user ? `<span class="badge-pill badge-user">@${escapeHtml(item.user)}</span>` : ''}
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

window.openAssetModal = function(index) {
	const item = state.lastAssets[index];
	if (!item) return;

	const dialog = document.getElementById('asset-dialog');
	const titleEl = document.getElementById('asset-dialog-title');
	const bodyEl = document.getElementById('asset-dialog-body');
	if (!dialog || !bodyEl) return;

	if (titleEl) {
		titleEl.textContent = item.filename || item.id;
	}

	const mediaHtml = item.type === 'VIDEO'
		? `<video src="${escapeHtml(item.originalUrl)}" controls autoplay playsinline></video>`
		: `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.filename)}">`;

	const locParts = [item.city, item.state, item.country].filter(Boolean).join(', ');
	const camParts = [item.make, item.model, item.lensModel].filter(Boolean).join(' · ');

	bodyEl.innerHTML = `
		<div class="dialog-media-box">
			${mediaHtml}
		</div>
		<div class="dialog-meta-list">
			<div class="meta-row">
				<span class="meta-label">Asset ID</span>
				<span class="meta-val"><code>${escapeHtml(item.id)}</code></span>
			</div>
			${item.user ? `
			<div class="meta-row">
				<span class="meta-label">Account</span>
				<span class="meta-val">@${escapeHtml(item.user)}</span>
			</div>` : ''}
			${item.takenAt ? `
			<div class="meta-row">
				<span class="meta-label">Date Taken</span>
				<span class="meta-val">${escapeHtml(item.takenAt)}</span>
			</div>` : ''}
			${locParts ? `
			<div class="meta-row">
				<span class="meta-label">Location</span>
				<span class="meta-val">📍 ${escapeHtml(locParts)}</span>
			</div>` : ''}
			${(item.people && item.people.length) ? `
			<div class="meta-row">
				<span class="meta-label">People</span>
				<span class="meta-val">👤 ${escapeHtml(item.people.join(', '))}</span>
			</div>` : ''}
			${(item.tags && item.tags.length) ? `
			<div class="meta-row">
				<span class="meta-label">Tags</span>
				<span class="meta-val">🏷️ ${escapeHtml(item.tags.join(', '))}</span>
			</div>` : ''}
			${camParts ? `
			<div class="meta-row">
				<span class="meta-label">Camera & Lens</span>
				<span class="meta-val">📷 ${escapeHtml(camParts)}</span>
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

	dialog.showModal();
};

function setupDialogLightDismissFallback() {
	const dialog = document.getElementById('asset-dialog');
	if (!dialog) return;

	// Stop playing video when modal closes
	dialog.addEventListener('close', () => {
		const bodyEl = document.getElementById('asset-dialog-body');
		if (bodyEl) bodyEl.innerHTML = '';
	});

	// Mandatory fallback for browsers without closedby="any" support
	if (!('closedBy' in HTMLDialogElement.prototype)) {
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
	}
}

// ==========================================================================
// Bootstrap & Event Listeners
// ==========================================================================

async function bootstrapApp() {
	const urlParams = new URLSearchParams(window.location.search);
	const initialUser = urlParams.get('user') || '';
	const initialFilter = urlParams.get('filter') || '';

	try {
		const resp = await fetch('/api/bootstrap' + (initialUser ? `?user=${encodeURIComponent(initialUser)}` : ''));
		const data = await resp.json();

		state.immichUrl = data.immichUrl || '';
		state.externalUrl = data.externalUrl || '';
		state.accounts = data.accounts || [];
		state.selectedUser = data.selectedUser || '';
		state.metadata = data.metadata || state.metadata;

		if (data.defaults) {
			state.sampleSize = data.defaults.sampleSize || 24;
			state.searchMode = data.defaults.searchMode || 'random';
			state.includeVideos = data.defaults.includeVideos !== false;
			state.includeArchived = !!data.defaults.includeArchived;
		}

		updateConnectionBanner(data);
		populateAccountsSelector();
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
		if (lbl) lbl.textContent = data.immichUrl;
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
	const wrap = document.getElementById('account-selector-wrap');
	const select = document.getElementById('account-select');
	if (!wrap || !select) return;

	if (state.accounts.length > 0) {
		wrap.hidden = false;
		select.innerHTML = `<option value="">All Accounts (${state.accounts.length})</option>` +
			state.accounts.map(u => `<option value="${escapeHtml(u)}" ${state.selectedUser === u ? 'selected' : ''}>@${escapeHtml(u)}</option>`).join('');
	} else {
		wrap.hidden = true;
	}
}

function syncToolbarControls() {
	const vidToggle = document.getElementById('toggle-include-videos');
	if (vidToggle) vidToggle.checked = state.includeVideos;

	const archToggle = document.getElementById('toggle-include-archived');
	if (archToggle) archToggle.checked = state.includeArchived;

	document.querySelectorAll('.seg-btn[data-search-mode]').forEach(btn => {
		btn.classList.toggle('active', btn.dataset.searchMode === state.searchMode);
	});

	const reshuffleBtn = document.getElementById('btn-reshuffle');
	const sortSelect = document.getElementById('metadata-sort-select');
	if (reshuffleBtn) reshuffleBtn.hidden = (state.searchMode !== 'random');
	if (sortSelect) sortSelect.hidden = (state.searchMode !== 'metadata');

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
	} catch (err) {
		setJsonSyncStatus('error', '⚠️ ' + err.message);
	}
}

function applyPreset(presetName) {
	if (presetName === 'Clear') {
		state.ruleTree = { id: 'root', type: 'group', combiner: 'AND', children: [] };
	} else if (presetName === 'favorites') {
		state.ruleTree = {
			id: 'root',
			type: 'group',
			combiner: 'AND',
			children: [
				{ id: generateNodeId('r'), type: 'rule', field: 'favorite', operator: 'true', value: true },
				{ id: generateNodeId('r'), type: 'rule', field: 'media_type', operator: 'IMAGE', value: 'IMAGE' }
			]
		};
	} else if (presetName === 'nested-or') {
		const sampleCountries = state.metadata.countries.slice(0, 2);
		const samplePeople = state.metadata.people.slice(0, 1).map(p => p.id);
		state.ruleTree = {
			id: 'root',
			type: 'group',
			combiner: 'AND',
			children: [
				{ id: generateNodeId('r'), type: 'rule', field: 'favorite', operator: 'true', value: true },
				{
					id: generateNodeId('g'),
					type: 'group',
					combiner: 'OR',
					children: [
						{ id: generateNodeId('r'), type: 'rule', field: 'country', operator: 'in', value: sampleCountries },
						{ id: generateNodeId('r'), type: 'rule', field: 'people', operator: 'any', value: samplePeople }
					]
				}
			]
		};
	}
	renderRuleTree();
	syncFromRuleTree();
}

document.addEventListener('DOMContentLoaded', () => {
	setupDialogLightDismissFallback();
	bootstrapApp();

	// Close dropdowns when clicking outside value box
	document.addEventListener('click', (e) => {
		if (!e.target.closest('.rt-value-box')) {
			document.querySelectorAll('.rt-dropdown-menu.open').forEach(el => el.classList.remove('open'));
		}
	});

	// Theme switcher
	document.querySelectorAll('.theme-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			const theme = btn.dataset.theme;
			document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b === btn));
			if (theme === 'auto') {
				document.documentElement.removeAttribute('data-theme');
			} else {
				document.documentElement.setAttribute('data-theme', theme);
			}
		});
	});

	// Account change
	const accountSelect = document.getElementById('account-select');
	if (accountSelect) {
		accountSelect.addEventListener('change', async () => {
			state.selectedUser = accountSelect.value;
			const resp = await fetch('/api/bootstrap' + (state.selectedUser ? `?user=${encodeURIComponent(state.selectedUser)}` : ''));
			const data = await resp.json();
			state.metadata = data.metadata || state.metadata;
			renderRuleTree();
			syncFromRuleTree();
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
				const resp = await fetch('/api/metadata/refresh' + (state.selectedUser ? `?user=${encodeURIComponent(state.selectedUser)}` : ''), {
					method: 'POST'
				});
				const data = await resp.json();
				if (data.metadata) state.metadata = data.metadata;
				renderRuleTree();
			} finally {
				refreshBtn.disabled = false;
				refreshBtn.innerHTML = origText;
			}
		});
	}

	// Presets
	document.querySelectorAll('[data-preset]').forEach(btn => {
		btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
	});

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
				setJsonSyncStatus('error', '⚠️ Syntax Error');
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
	document.querySelectorAll('.seg-btn[data-search-mode]').forEach(btn => {
		btn.addEventListener('click', () => {
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
			state.orderByField = field || 'takenAt';
			state.orderByDirection = dir || 'desc';
			runLiveSearch();
		});
	}

	// Video & Archived toggles
	const vidToggle = document.getElementById('toggle-include-videos');
	if (vidToggle) {
		vidToggle.addEventListener('change', () => {
			state.includeVideos = vidToggle.checked;
			runLiveSearch();
		});
	}

	const archToggle = document.getElementById('toggle-include-archived');
	if (archToggle) {
		archToggle.addEventListener('change', () => {
			state.includeArchived = archToggle.checked;
			runLiveSearch();
		});
	}

	// Sample size pills
	document.querySelectorAll('.limit-pill').forEach(btn => {
		btn.addEventListener('click', () => {
			state.sampleSize = parseInt(btn.dataset.limit, 10) || 24;
			syncToolbarControls();
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

