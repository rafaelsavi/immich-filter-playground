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
				<div class="rt-dropdown-item ${isSel ? 'selected' : ''}" onclick="rtToggleMultiValue('${escapeJsString(rule.id)}', '${escapeJsString(opt.value)}', event)">
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

function mergeFilterBranches(left, right) {
	const merged = { ...left };
	for (const [key, value] of Object.entries(right)) {
		const existing = merged[key];
		if (existing && value && typeof existing === 'object' && typeof value === 'object' &&
			!Array.isArray(existing) && !Array.isArray(value)) {
			merged[key] = { ...existing, ...value };
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
		loadMoreWrap.hidden = !((total > assets.length || !exact) && state.sampleSize < 240);
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
							${item.user ? `<button type="button" class="badge-pill badge-user interactive-badge" onclick="event.stopPropagation(); filterByAccount('${escapeHtml(item.user)}')" title="Click to filter by @${escapeHtml(item.user)}">@${escapeHtml(item.user)}</button>` : ''}
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
				<span class="meta-val"><button type="button" class="badge-pill badge-user interactive-badge" onclick="const d = document.getElementById('asset-dialog'); if (d) d.close(); filterByAccount('${escapeHtml(item.user)}')" title="Filter by @${escapeHtml(item.user)}">@${escapeHtml(item.user)}</button></span>
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
		state.accountDetails = data.accountDetails || [];
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
		await loadProfiles();

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
		<button type="button" class="account-menu-item ${isAllActive ? 'active' : ''}" onclick="selectAccount('')" role="option" aria-selected="${isAllActive}">
			<span>👥 All Accounts (${state.accounts.length})</span>
			<span class="account-item-status ok" title="Queries all accounts in parallel"></span>
		</button>
		<hr style="border:0;border-top:1px solid var(--border-color);margin:0.25rem 0;">
	`;

	itemsHtml += state.accounts.map(acc => {
		const isActive = (state.selectedUser === acc);
		const isOk = healthMap[acc] !== false;
		return `
			<button type="button" class="account-menu-item ${isActive ? 'active' : ''}" onclick="selectAccount('${escapeHtml(acc)}')" role="option" aria-selected="${isActive}">
				<span>👤 @${escapeHtml(acc)}</span>
				<span class="account-item-status ${isOk ? 'ok' : 'err'}" title="${isOk ? 'Active & authenticated' : 'Metadata query reported warnings/errors'}"></span>
			</button>
		`;
	}).join('');

	menuPopover.innerHTML = itemsHtml;
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

	try {
		const resp = await fetch('/api/metadata/refresh' + (state.selectedUser ? `?user=${encodeURIComponent(state.selectedUser)}` : ''), {
			method: 'POST'
		});
		const data = await resp.json();
		if (data.metadata) state.metadata = data.metadata;
		if (data.accountHealth) {
			state.accountDetails = Object.keys(data.accountHealth).map(k => ({ name: k, valid: data.accountHealth[k] }));
			renderAccountMenu();
		}
		renderRuleTree();
	} catch (e) {
		console.warn('Metadata refresh failed on account switch:', e);
	}

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
		opt.textContent = `📁 ${p.name}`;
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
	if (!saveButton) return;
	const hasActiveProfile = !!(state.activeProfileId && state.activeProfileId.startsWith('prof_'));
	const profile = hasActiveProfile ? state.profiles.find(item => item.id === state.activeProfileId) : null;
	const hasUnsavedChanges = hasActiveProfile && isProfileDirty(state.activeProfileId);
	const needsServerSync = hasActiveProfile && !!(profile && profile.pendingSync);
	saveButton.innerHTML = hasActiveProfile
		? (hasUnsavedChanges
			? '<span>💾 Save Changes</span>'
			: (needsServerSync ? '<span>↥ Sync to Server</span>' : '<span>✏️ Rename</span>'))
		: '<span>💾 Save as Profile</span>';
	saveButton.title = hasActiveProfile
		? (hasUnsavedChanges
			? 'Save the current filter and settings to this profile'
			: (needsServerSync ? 'Sync this browser-saved profile to the server' : 'Rename the selected profile'))
		: 'Save the current filter as a new profile';
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
		return rule.dateAfter || rule.dateBefore || '';
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
	const added = [...next.rules.values()].filter(rule => !previous.rules.has(rule.id));
	const removed = [...previous.rules.values()].filter(rule => !next.rules.has(rule.id));
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
	if (added.length) details.push(`Added: ${summarizeHistoryRules(added)}`);
	if (removed.length) details.push(`Removed: ${summarizeHistoryRules(removed)}`);
	if (changed.length) details.push(`Changed: ${summarizeHistoryRules(changed)}`);
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
		return getHistoryDescription(previous.snapshot, entry.snapshot);
	}
	return { label: entry.label || 'Updated profile', detail: '' };
}

function setProfileHistoryStatus(message, failed = false) {
	const status = document.getElementById('profile-history-status');
	if (!status) return;
	status.textContent = message;
	status.classList.toggle('error', failed);
}

function renderProfileHistory() {
	const list = document.getElementById('profile-history-list');
	const undoButton = document.getElementById('btn-undo-profile');
	const redoButton = document.getElementById('btn-redo-profile');
	const profile = state.profiles.find(p => p.id === state.activeProfileId);
	if (!list || !undoButton || !redoButton) return;

	list.replaceChildren();
	if (!profile || !Array.isArray(profile.history) || profile.history.length === 0) {
		undoButton.disabled = true;
		redoButton.disabled = true;
		setProfileHistoryStatus('Select a saved profile to track changes.');
		return;
	}

	const historyIndex = Math.max(0, Math.min(profile.historyIndex || 0, profile.history.length - 1));
	undoButton.disabled = historyIndex <= 0;
	redoButton.disabled = historyIndex >= profile.history.length - 1;
	for (let i = profile.history.length - 1; i >= 0; i--) {
		const entry = profile.history[i];
		const item = document.createElement('li');
		const button = document.createElement('button');
		const label = document.createElement('span');
		const detail = document.createElement('span');
		const time = document.createElement('time');
		const description = getProfileHistoryEntryDescription(profile.history, i);
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
		renderProfileHistory();
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
	if (wasAtHistoryEnd && lastEntry && lastEntry.label === description.label && now.getTime() - new Date(lastEntry.timestamp).getTime() < 750) {
		lastEntry.label = description.label;
		lastEntry.detail = description.detail;
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
	return true;
}

function restoreProfileHistory(index) {
	const profile = state.profiles.find(p => p.id === state.activeProfileId);
	if (!profile || !Array.isArray(profile.history) || !profile.history[index]) return;

	profileHistoryApplying = true;
	let restored = false;
	try {
		restored = applyProfileSnapshot(profile.history[index].snapshot);
	} finally {
		profileHistoryApplying = false;
	}
	if (!restored) return;
	profile.historyIndex = index;
	Object.assign(profile, getProfileSnapshot());
	renderProfileHistory();
	updateProfileActionLabels();
	setProfileHistoryStatus(isActiveProfileDirty() ? 'Unsaved changes. Save Changes to keep them.' : 'No unsaved changes.');
}

function undoProfileHistory() {
	const profile = state.profiles.find(p => p.id === state.activeProfileId);
	if (profile && (profile.historyIndex || 0) > 0) {
		restoreProfileHistory(profile.historyIndex - 1);
	}
}

function redoProfileHistory() {
	const profile = state.profiles.find(p => p.id === state.activeProfileId);
	if (profile && Array.isArray(profile.history) && (profile.historyIndex || 0) < profile.history.length - 1) {
		restoreProfileHistory(profile.historyIndex + 1);
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
		renderProfileHistory();
		updateProfileActionLabels();
		return;
	}

	// Load custom saved profile
	const prof = state.profiles.find(p => p.id === profileId);
	if (prof) {
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

	const filterEditor = document.getElementById('filter-json-editor');
	const rawFilterJson = filterEditor ? filterEditor.value : '{}';
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
		filterJson: rawFilterJson,
		ruleTree: snapshot.ruleTree,
		searchMode: state.searchMode,
		user: state.selectedUser,
		limit: state.sampleSize,
		orderByField: state.orderByField,
		orderByDirection: state.orderByDirection,
		includeVideos: state.includeVideos,
		includeArchived: state.includeArchived,
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
		const resp = await fetch('/api/profiles', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(profileData)
		});
		if (!resp.ok) throw new Error(`Profile save failed (${resp.status})`);
		const data = await resp.json();
		if (!data.profile || !data.profile.id) throw new Error('Profile save response did not include an ID');
		profileData.id = data.profile.id;
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
		if (confirmButton) confirmButton.disabled = false;
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
}

async function handleDeleteProfile() {
	if (!state.activeProfileId || !state.activeProfileId.startsWith('prof_')) return;
	const idToDelete = state.activeProfileId;
	const initialProfile = state.profiles.find(p => p.id === idToDelete);
	const name = initialProfile ? initialProfile.name : 'this profile';
	if (isProfileDirty(idToDelete) && !(await resolveUnsavedProfileChanges())) return;
	const profile = state.profiles.find(p => p.id === idToDelete);
	if (!profile) return;
	if (!confirm(`Are you sure you want to delete profile "${name}"?`)) {
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
	if (!saveProfilesToLocalStorage(profilesWithDeletionMarker)) {
		setProfileHistoryStatus('Could not prepare the profile deletion in browser storage; it was not deleted.', true);
		return;
	}

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
	setProfileHistoryStatus(savedLocally ? 'Profile deleted.' : 'Profile deleted from server; the saved deletion marker will remove it on reload.', !savedLocally);
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

document.addEventListener('DOMContentLoaded', () => {
	setupDialogLightDismissFallback();
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
		if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
		const target = event.target;
		if (target instanceof Element && target.matches('input, textarea, select, [contenteditable="true"]')) return;
		const activeProfile = state.profiles.find(p => p.id === state.activeProfileId);
		if (!activeProfile || !Array.isArray(activeProfile.history) || activeProfile.history.length < 2) return;
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

	const undoProfileBtn = document.getElementById('btn-undo-profile');
	if (undoProfileBtn) undoProfileBtn.addEventListener('click', undoProfileHistory);

	const redoProfileBtn = document.getElementById('btn-redo-profile');
	if (redoProfileBtn) redoProfileBtn.addEventListener('click', redoProfileHistory);

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
	document.querySelectorAll('.seg-btn[data-search-mode], .mode-toggle-btn[data-search-mode]').forEach(btn => {
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
			recordProfileHistory();
			runLiveSearch();
		});
	}
});

