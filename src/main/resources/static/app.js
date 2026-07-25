(function () {
    const state = {
        roots: [],
        selectedRootIndex: 0,
        lastXml: '',
        fileName: '',
        schemaId: '',
        mode: 'manual' // 'manual' | 'random'
    };

    const els = {
        uploadForm: document.getElementById('uploadForm'),
        xsdFile: document.getElementById('xsdFile'),
        dropZone: document.getElementById('dropZone'),
        selectedFileName: document.getElementById('selectedFileName'),
        uploadBtn: document.getElementById('uploadBtn'),
        uploadStatus: document.getElementById('uploadStatus'),
        resetBtn: document.getElementById('resetBtn'),
        fileBadge: document.getElementById('fileBadge'),
        formSection: document.getElementById('formSection'),
        dynamicForm: document.getElementById('dynamicForm'),
        rootSelectorWrap: document.getElementById('rootSelectorWrap'),
        rootSelector: document.getElementById('rootSelector'),
        modeManualBtn: document.getElementById('modeManualBtn'),
        modeRandomBtn: document.getElementById('modeRandomBtn'),
        manualHint: document.getElementById('manualHint'),
        randomHint: document.getElementById('randomHint'),
        includeOptionalTags: document.getElementById('includeOptionalTags'),
        countryCode: document.getElementById('countryCode'),
        countryContextHint: document.getElementById('countryContextHint'),
        cdtrAgtValue: document.getElementById('cdtrAgtValue'),
        dbtrAgtValue: document.getElementById('dbtrAgtValue'),
        dbtrAcctValue: document.getElementById('dbtrAcctValue'),
        cdtrAcctValue: document.getElementById('cdtrAcctValue'),
        fillRandomBtn: document.getElementById('fillRandomBtn'),
        generateBtn: document.getElementById('generateBtn'),
        downloadBtn: document.getElementById('downloadBtn'),
        generateStatus: document.getElementById('generateStatus'),
        validationErrors: document.getElementById('validationErrors'),
        validationErrorList: document.getElementById('validationErrorList'),
        previewSection: document.getElementById('previewSection'),
        xmlPreview: document.getElementById('xmlPreview'),
        copyBtn: document.getElementById('copyBtn')
    };

    function on(el, event, handler) {
        if (el) el.addEventListener(event, handler);
    }

    // File selection + drag/drop (label click opens the picker natively)
    on(els.xsdFile, 'change', () => {
        const file = els.xsdFile.files[0];
        if (!file) {
            els.selectedFileName.textContent = 'No file selected';
            return;
        }
        if (!isAllowedSchemaFile(file)) {
            els.xsdFile.value = '';
            els.selectedFileName.textContent = 'No file selected';
            setStatus(els.uploadStatus, 'Please choose a .xsd / .xml / .zip file.', true);
            return;
        }
        els.selectedFileName.textContent = file.name;
        setStatus(els.uploadStatus, '');
    });
    ['dragenter', 'dragover'].forEach(evt => {
        els.dropZone.addEventListener(evt, e => {
            e.preventDefault();
            els.dropZone.classList.add('dragover');
        });
    });
    ['dragleave', 'drop'].forEach(evt => {
        els.dropZone.addEventListener(evt, e => {
            e.preventDefault();
            els.dropZone.classList.remove('dragover');
        });
    });
    on(els.dropZone, 'drop', e => {
        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (!isAllowedSchemaFile(file)) {
            setStatus(els.uploadStatus, 'Please drop a .xsd / .xml / .zip file.', true);
            return;
        }
        const dt = new DataTransfer();
        dt.items.add(file);
        els.xsdFile.files = dt.files;
        els.selectedFileName.textContent = file.name;
        setStatus(els.uploadStatus, '');
    });

    on(els.uploadForm, 'submit', async (e) => {
        e.preventDefault();
        const file = els.xsdFile.files[0];
        if (!file) {
            setStatus(els.uploadStatus, 'Please choose an XSD file first.', true);
            return;
        }
        if (!isAllowedSchemaFile(file)) {
            setStatus(els.uploadStatus, 'Only .xsd / .xml / .zip files are supported.', true);
            return;
        }

        const formData = new FormData();
        // Force a .xsd filename so servers/proxies that inspect Content-Disposition stay happy
        formData.append('file', file, normalizeSchemaFileName(file.name));

        els.uploadBtn.disabled = true;
        setStatus(els.uploadStatus, 'Parsing schema…');

        try {
            const res = await fetch('/upload-xsd', { method: 'POST', body: formData });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch (_) {
                throw new Error(
                    'Upload failed (HTTP ' + res.status + '). '
                    + 'Server returned a non-JSON response — often caused by a too-large schema or a proxy timeout. '
                    + 'Try the official single-file pacs.008 XSD or a ZIP of related schemas. '
                    + 'Raw: ' + String(raw || '').slice(0, 180)
                );
            }
            if (!res.ok || !data.success) {
                throw new Error(data.message || ('Upload failed (HTTP ' + res.status + ')'));
            }

            state.roots = data.roots || [];
            state.selectedRootIndex = 0;
            // Prefer Document root for ISO 20022
            const docIdx = state.roots.findIndex(r => r && r.name === 'Document');
            if (docIdx >= 0) state.selectedRootIndex = docIdx;
            state.fileName = data.fileName || file.name;
            state.schemaId = data.schemaId || '';
            state.lastXml = '';
            clearValidationErrors();

            if (!state.roots.length) {
                throw new Error('No root elements found in schema');
            }
            if (!state.schemaId) {
                throw new Error('Server did not return a schemaId for validation');
            }

            els.fileBadge.textContent = state.fileName;
            els.fileBadge.classList.remove('hidden');
            setStatus(els.uploadStatus, `Parsed ${state.roots.length} root element(s) from ${state.fileName}. Ready for validated generation.`, false);
            renderRootSelector();
            renderForm();
            setMode('manual');
            els.formSection.classList.remove('hidden');
            els.previewSection.classList.add('hidden');
            els.downloadBtn.disabled = true;
            els.formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
            setStatus(els.uploadStatus, err.message, true);
            els.formSection.classList.add('hidden');
        } finally {
            els.uploadBtn.disabled = false;
        }
    });

    on(els.rootSelector, 'change', () => {
        state.selectedRootIndex = Number(els.rootSelector.value);
        renderForm();
        els.previewSection.classList.add('hidden');
        els.downloadBtn.disabled = true;
        state.lastXml = '';
        clearValidationErrors();
        if (state.mode === 'random') {
            fillFormWithRandomValues();
        }
    });

    on(els.modeManualBtn, 'click', () => setMode('manual'));
    on(els.modeRandomBtn, 'click', () => setMode('random'));
    on(els.includeOptionalTags, 'change', () => {
        applyOptionalTagVisibility();
        if (state.mode === 'random') fillAllVisibleControls(els.dynamicForm);
        clearGeneratedResult();
    });
    on(els.countryCode, 'input', () => {
        els.countryCode.value = els.countryCode.value.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
        updateCountryContextHint();
        applyCountryContextToForm();
        clearGeneratedResult();
    });
    [els.cdtrAgtValue, els.dbtrAgtValue, els.dbtrAcctValue, els.cdtrAcctValue].forEach(input => {
        on(input, 'input', () => {
            applyPaymentContextToForm();
            clearGeneratedResult();
        });
    });
    on(els.fillRandomBtn, 'click', () => {
        fillFormWithRandomValues();
        const n = els.dynamicForm.querySelectorAll('input:not([disabled]), select:not([disabled])').length;
        setStatus(els.generateStatus, `Filled ${n} visible field(s) with random valid values. Review and generate XML.`, false);
    });

    on(els.resetBtn, 'click', () => {
        state.roots = [];
        state.selectedRootIndex = 0;
        state.lastXml = '';
        state.fileName = '';
        state.schemaId = '';
        state.mode = 'manual';
        els.includeOptionalTags.checked = true;
        els.countryCode.value = '';
        els.cdtrAgtValue.value = '';
        els.dbtrAgtValue.value = '';
        els.dbtrAcctValue.value = '';
        els.cdtrAcctValue.value = '';
        updateCountryContextHint();
        els.uploadForm.reset();
        els.selectedFileName.textContent = 'No file selected';
        els.uploadStatus.textContent = '';
        els.generateStatus.textContent = '';
        clearValidationErrors();
        els.fileBadge.classList.add('hidden');
        els.formSection.classList.add('hidden');
        els.previewSection.classList.add('hidden');
        els.dynamicForm.innerHTML = '';
        els.downloadBtn.disabled = true;
        applyModeUi();
    });

    on(els.generateBtn, 'click', async () => {
        // In random mode, only auto-fill if the form still looks empty
        if (state.mode === 'random' && isFormEffectivelyEmpty()) {
            fillFormWithRandomValues();
        }

        const payload = buildPayload();
        if (!payload) return;

        els.generateBtn.disabled = true;
        clearValidationErrors();
        setStatus(els.generateStatus, state.mode === 'random'
            ? 'Generating from random values and validating against uploaded XSD…'
            : 'Generating and validating against uploaded XSD…');

        try {
            const res = await fetch('/generate-xml', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                showValidationErrors(data);
                throw new Error(data.message || 'Generation / validation failed');
            }

            state.lastXml = data.xml || '';
            els.xmlPreview.textContent = state.lastXml;
            els.previewSection.classList.remove('hidden');
            els.downloadBtn.disabled = false;
            setStatus(els.generateStatus, state.mode === 'random'
                ? 'Random XML generated and validated successfully against the uploaded XSD.'
                : 'XML generated and validated successfully against the uploaded XSD.', false);
            els.previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
            setStatus(els.generateStatus, err.message, true);
            els.downloadBtn.disabled = true;
            els.previewSection.classList.add('hidden');
        } finally {
            els.generateBtn.disabled = false;
        }
    });

    on(els.downloadBtn, 'click', async () => {
        const payload = buildPayload();
        if (!payload) return;

        clearValidationErrors();
        try {
            const res = await fetch('/download-xml', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showValidationErrors(err);
                throw new Error(err.message || 'Download failed');
            }
            const blob = await res.blob();
            const disposition = res.headers.get('Content-Disposition') || '';
            const match = /filename="?([^"]+)"?/.exec(disposition);
            const fileName = match ? match[1] : ((payload.schema.name || 'document') + '.xml');

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setStatus(els.generateStatus, 'Validated XML download started.', false);
        } catch (err) {
            setStatus(els.generateStatus, err.message, true);
        }
    });

    on(els.copyBtn, 'click', async () => {
        if (!state.lastXml) return;
        try {
            await navigator.clipboard.writeText(state.lastXml);
            els.copyBtn.textContent = 'Copied';
            setTimeout(() => { els.copyBtn.textContent = 'Copy'; }, 1500);
        } catch (_) {
            els.copyBtn.textContent = 'Copy failed';
            setTimeout(() => { els.copyBtn.textContent = 'Copy'; }, 1500);
        }
    });

    function renderRootSelector() {
        if (state.roots.length > 1) {
            els.rootSelectorWrap.classList.remove('hidden');
            els.rootSelector.innerHTML = state.roots.map((r, i) =>
                `<option value="${i}">${escapeHtml(r.name)}</option>`
            ).join('');
        } else {
            els.rootSelectorWrap.classList.add('hidden');
            els.rootSelector.innerHTML = '';
        }
    }

    function renderForm() {
        const root = state.roots[state.selectedRootIndex];
        els.dynamicForm.innerHTML = '';
        if (!root) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'field-card bg-slate-50 rounded-xl p-4 border border-slate-200';
        wrapper.innerHTML = `
            <div class="flex items-center justify-between mb-3">
                <div>
                    <h3 class="font-semibold text-slate-900">&lt;${escapeHtml(root.name)}&gt;</h3>
                    <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(root.type || 'complex')} · ${escapeHtml(root.xpath || '')}</p>
                </div>
                ${root.required ? '<span class="text-xs text-rose-600 font-medium">required</span>' : ''}
            </div>
        `;

        const childrenHost = document.createElement('div');
        childrenHost.className = 'space-y-3';
        childrenHost.dataset.path = root.name;

        if (root.complex && root.children && root.children.length) {
            root.children.forEach(child => childrenHost.appendChild(renderField(child, root.name)));
        } else {
            childrenHost.appendChild(renderSimpleInput(root, root.name, true));
        }

        wrapper.appendChild(childrenHost);
        els.dynamicForm.appendChild(wrapper);
        applyOptionalTagVisibility();
        applyCountryContextToForm();
        applyPaymentContextToForm();
    }

    function renderField(field, parentPath) {
        const path = parentPath + '.' + field.name;
        const container = document.createElement('div');
        container.dataset.optionalTag = (!field.required && !field.choiceGroup) ? '1' : '0';

        if (field.complex) {
            container.className = 'nested-card bg-white rounded-lg p-4 border border-slate-200';
            if (field.choiceGroup) {
                container.dataset.choiceGroup = field.choiceGroup;
                container.dataset.choiceBranch = field.choiceBranch == null ? '0' : String(field.choiceBranch);
            }
            const header = document.createElement('div');
            header.className = 'flex items-center justify-between mb-3';
            header.innerHTML = `
                <div>
                    <p class="font-medium text-slate-800">&lt;${escapeHtml(field.name)}&gt;${field.choiceGroup ? ' <span class="text-[10px] text-amber-700 font-normal">(choice)</span>' : ''}</p>
                    <p class="text-xs text-slate-500">${escapeHtml(field.type || 'complex')}${field.documentation ? ' · ' + escapeHtml(field.documentation) : ''}</p>
                </div>
                <div class="flex items-center gap-2">
                    ${field.required ? '<span class="text-xs text-rose-600">*</span>' : '<span class="text-xs text-slate-400">optional</span>'}
                    ${field.repeatable || field.maxOccurs === -1 || field.maxOccurs > 1
                        ? `<span class="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-600 px-2 py-0.5 rounded">max ${field.maxOccurs === -1 ? '∞' : field.maxOccurs}</span>`
                        : ''}
                </div>
            `;
            container.appendChild(header);

            const instancesHost = document.createElement('div');
            instancesHost.className = 'space-y-3';
            instancesHost.dataset.repeatHost = path;
            instancesHost.dataset.fieldName = field.name;

            const addInstance = () => {
                const instance = document.createElement('div');
                instance.className = 'space-y-3 pl-1 border-l-2 border-slate-100';
                instance.dataset.instance = 'true';
                (field.children || []).forEach(child => instance.appendChild(renderField(child, path)));
                instancesHost.appendChild(instance);
            };

            addInstance();
            container.appendChild(instancesHost);

            if (field.repeatable || field.maxOccurs === -1 || field.maxOccurs > 1) {
                const addBtn = document.createElement('button');
                addBtn.type = 'button';
                addBtn.className = 'mt-3 text-xs text-accentDark hover:underline';
                addBtn.textContent = `+ Add another <${field.name}>`;
                addBtn.addEventListener('click', () => {
                    const max = field.maxOccurs === -1 ? Infinity : field.maxOccurs;
                    const count = instancesHost.querySelectorAll('[data-instance="true"]').length;
                    if (count >= max) {
                        alert(`Maximum occurrences (${max}) reached for ${field.name}`);
                        return;
                    }
                    addInstance();
                });
                container.appendChild(addBtn);
            }
        } else {
            container.appendChild(renderSimpleInput(field, path, false));
        }

        return container;
    }

    function renderSimpleInput(field, path, isRootLeaf) {
        const wrap = document.createElement('div');
        wrap.className = 'space-y-1';
        wrap.dataset.simpleField = field.name;
        wrap.dataset.path = path;
        if (field.choiceGroup) {
            wrap.dataset.choiceGroup = field.choiceGroup;
            wrap.dataset.choiceBranch = field.choiceBranch == null ? '0' : String(field.choiceBranch);
        }

        const label = document.createElement('label');
        label.className = 'block text-sm font-medium text-slate-700';
        const choiceNote = field.choiceGroup
            ? ` <span class="text-[10px] font-normal text-amber-700">(choice)</span>`
            : '';
        const anyNote = field.wildcard || field.type === 'any'
            ? ` <span class="text-[10px] font-normal text-violet-700">(xs:any)</span>`
            : '';
        label.innerHTML = `${escapeHtml(field.name)}${field.required ? ' <span class="text-rose-600">*</span>' : ''}${choiceNote}${anyNote}`;
        wrap.appendChild(label);

        if (field.documentation) {
            const hint = document.createElement('p');
            hint.className = 'text-xs text-slate-400';
            hint.textContent = field.documentation;
            wrap.appendChild(hint);
        }

        const input = createInputControl(field);
        input.dataset.fieldName = field.name;
        input.dataset.path = path;
        stampFieldMeta(input, field);
        if (input.type !== 'checkbox') {
            input.classList.add('w-full', 'border', 'border-slate-300', 'rounded-lg', 'px-3', 'py-2', 'text-sm', 'bg-white', 'focus:outline-none', 'focus:ring-2', 'focus:ring-sky-300');
        }
        if (field.required && input.type !== 'checkbox') input.required = true;

        if (field.repeatable || field.maxOccurs === -1 || field.maxOccurs > 1) {
            const list = document.createElement('div');
            list.className = 'space-y-2';
            list.dataset.repeatSimple = path;

            const row = document.createElement('div');
            row.className = 'flex gap-2 items-center';
            row.appendChild(input.cloneNode(true));
            list.appendChild(row);
            wrap.appendChild(list);

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'text-xs text-accentDark hover:underline';
            addBtn.textContent = `+ Add another ${field.name}`;
            addBtn.addEventListener('click', () => {
                const max = field.maxOccurs === -1 ? Infinity : field.maxOccurs;
                if (list.children.length >= max) {
                    alert(`Maximum occurrences (${max}) reached for ${field.name}`);
                    return;
                }
                const r = document.createElement('div');
                r.className = 'flex gap-2 items-center';
                r.appendChild(input.cloneNode(true));
                list.appendChild(r);
            });
            wrap.appendChild(addBtn);
        } else if (input.type === 'checkbox') {
            const checkLabel = document.createElement('label');
            checkLabel.className = 'inline-flex items-center gap-2 text-sm text-slate-700';
            checkLabel.appendChild(input);
            const span = document.createElement('span');
            span.textContent = 'Yes / true';
            checkLabel.appendChild(span);
            wrap.appendChild(checkLabel);
        } else {
            wrap.appendChild(input);
        }

        // XML attributes (e.g. InstdAmt/@Ccy)
        if (field.attributes && field.attributes.length) {
            const attrBox = document.createElement('div');
            attrBox.className = 'mt-2 grid sm:grid-cols-2 gap-2 pl-2 border-l-2 border-sky-200';
            field.attributes.forEach(attr => {
                const aWrap = document.createElement('div');
                const aLabel = document.createElement('label');
                aLabel.className = 'block text-xs font-medium text-slate-600';
                aLabel.innerHTML = `@${escapeHtml(attr.name)}${attr.required ? ' <span class="text-rose-600">*</span>' : ''}`;
                const aInput = createInputControl(attr);
                aInput.dataset.attrName = attr.name;
                aInput.dataset.optionalAttribute = attr.required ? '0' : '1';
                stampFieldMeta(aInput, attr);
                aInput.classList.add('w-full', 'border', 'border-slate-300', 'rounded-lg', 'px-2', 'py-1.5', 'text-sm', 'bg-white');
                if (attr.required) aInput.required = true;
                aWrap.appendChild(aLabel);
                aWrap.appendChild(aInput);
                attrBox.appendChild(aWrap);
            });
            wrap.appendChild(attrBox);
        }

        const meta = document.createElement('p');
        meta.className = 'text-[11px] text-slate-400';
        const facetBits = [];
        if (field.pattern) facetBits.push('pattern');
        if (field.maxLength != null) facetBits.push('maxLen ' + field.maxLength);
        if (field.typeName) facetBits.push(field.typeName);
        meta.textContent = `${field.type || 'string'} · occurs ${field.minOccurs}..${field.maxOccurs === -1 ? 'unbounded' : field.maxOccurs}${facetBits.length ? ' · ' + facetBits.join(', ') : ''}`;
        wrap.appendChild(meta);

        return wrap;
    }

    function createInputControl(field) {
        const type = (field.type || 'string').toLowerCase();
        const enums = field.enumerations || [];

        if (type === 'enumeration' || enums.length > 0) {
            const select = document.createElement('select');
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = field.required ? 'Select…' : '(optional)';
            select.appendChild(placeholder);
            enums.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                select.appendChild(opt);
            });
            return select;
        }

        if (type === 'boolean') {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400';
            input.value = 'true';
            return input;
        }

        const input = document.createElement('input');
        // Prefer text when a pattern exists so values like "072" or IBAN stay intact
        // (Windows Chrome silently clears invalid number/date values).
        if (field.pattern) {
            input.type = 'text';
        } else if (type === 'integer' || type === 'decimal') {
            input.type = 'number';
            if (type === 'integer') input.step = '1';
            else input.step = 'any';
        } else if (type === 'date') {
            input.type = 'date';
        } else if (type === 'datetime') {
            input.type = 'datetime-local';
        } else if (type === 'time') {
            input.type = 'time';
        } else if (type === 'gyearmonth') {
            input.type = 'month';
        } else {
            input.type = 'text';
        }
        input.placeholder = `Enter ${field.name}`;
        return input;
    }

    function isFormEffectivelyEmpty() {
        const controls = els.dynamicForm.querySelectorAll('input, select');
        for (const el of controls) {
            if (el.type === 'checkbox') {
                if (el.checked) return false;
            } else if (String(el.value || '').trim() !== '') {
                return false;
            }
        }
        return true;
    }

    function setMode(mode) {
        state.mode = mode === 'random' ? 'random' : 'manual';
        applyModeUi();
        if (state.mode === 'random' && state.roots.length) {
            fillFormWithRandomValues();
            setStatus(els.generateStatus, 'Random valid values applied. Click Generate & Validate XML, or Fill random values again for a new set.', false);
        } else {
            // Re-render empty form for manual entry
            renderForm();
            setStatus(els.generateStatus, '');
        }
        clearValidationErrors();
        els.previewSection.classList.add('hidden');
        els.downloadBtn.disabled = true;
        state.lastXml = '';
    }

    function applyModeUi() {
        const manual = state.mode === 'manual';
        els.modeManualBtn.className = manual
            ? 'mode-card text-left rounded-xl border-2 border-sky-500 bg-sky-50 p-4 transition hover:border-sky-600'
            : 'mode-card text-left rounded-xl border-2 border-slate-200 bg-white p-4 transition hover:border-slate-400';
        els.modeRandomBtn.className = !manual
            ? 'mode-card text-left rounded-xl border-2 border-amber-500 bg-amber-50 p-4 transition hover:border-amber-600'
            : 'mode-card text-left rounded-xl border-2 border-slate-200 bg-white p-4 transition hover:border-slate-400';
        els.manualHint.classList.toggle('hidden', !manual);
        els.randomHint.classList.toggle('hidden', manual);
        els.fillRandomBtn.classList.toggle('hidden', manual);
        els.generateBtn.textContent = manual
            ? 'Generate & Validate XML'
            : 'Generate with random values & Validate';
    }

    function fillFormWithRandomValues() {
        const root = state.roots[state.selectedRootIndex];
        if (!root) return;
        renderForm();
        // 1) Pick one branch per xs:choice and hide the rest
        resolveAndLockChoices(els.dynamicForm);
        // 2) Apply the user's optional-element preference after choices are selected
        applyOptionalTagVisibility();
        // 3) Fill every visible (non-disabled) control from its own stamped XSD metadata
        fillAllVisibleControls(els.dynamicForm);
        // 4) Windows/Chromium can silently reject invalid number/date/select values —
        //    sweep any blanks that remain and force a stuck-safe value.
        fillAnyRemainingBlankControls(root, els.dynamicForm);
        forceFillStillBlankControls(els.dynamicForm);
        applyCountryContextToForm();
        applyPaymentContextToForm();
    }

    function applyOptionalTagVisibility() {
        const include = els.includeOptionalTags.checked;
        els.dynamicForm.querySelectorAll('[data-optional-tag="1"]').forEach(host => {
            // Never re-enable controls inside a deselected xs:choice branch
            if (host.closest('[data-choice-selected="0"]') || host.dataset.choiceSelected === '0') {
                host.classList.add('hidden');
                host.querySelectorAll('input, select, button').forEach(control => {
                    control.disabled = true;
                    if (control.type === 'checkbox') control.checked = false;
                    else if (control.tagName !== 'BUTTON') control.value = '';
                });
                return;
            }
            host.classList.toggle('hidden', !include);
            host.querySelectorAll('input, select, button').forEach(control => {
                if (control.closest('[data-choice-selected="0"]')) {
                    control.disabled = true;
                    return;
                }
                control.disabled = !include;
                if (!include) {
                    if (control.type === 'checkbox') control.checked = false;
                    else if (control.tagName !== 'BUTTON') control.value = '';
                }
            });
        });
        els.dynamicForm.querySelectorAll('[data-optional-attribute="1"]').forEach(input => {
            if (input.closest('[data-choice-selected="0"]')) {
                const host = input.parentElement;
                if (host) host.classList.add('hidden');
                input.disabled = true;
                input.value = '';
                return;
            }
            const host = input.parentElement;
            if (host) host.classList.toggle('hidden', !include);
            input.disabled = !include;
            if (!include) input.value = '';
        });
    }

    function clearGeneratedResult() {
        state.lastXml = '';
        els.previewSection.classList.add('hidden');
        els.downloadBtn.disabled = true;
        clearValidationErrors();
    }

    /** For each choice group, keep one branch visible and disable/clear the others. */
    function resolveAndLockChoices(container) {
        const groups = new Map();
        container.querySelectorAll('[data-choice-group]').forEach(el => {
            const g = el.getAttribute('data-choice-group');
            const b = el.getAttribute('data-choice-branch') || '0';
            if (!g) return;
            if (!groups.has(g)) groups.set(g, new Set());
            groups.get(g).add(b);
        });

        const chosen = new Map();
        groups.forEach((branches, g) => {
            const arr = Array.from(branches);
            chosen.set(g, arr[randInt(0, arr.length - 1)]);
        });

        container.querySelectorAll('[data-choice-group]').forEach(el => {
            const g = el.getAttribute('data-choice-group');
            const b = el.getAttribute('data-choice-branch') || '0';
            const selected = chosen.get(g) === b;
            el.dataset.choiceSelected = selected ? '1' : '0';
            if (!selected) {
                el.classList.add('opacity-40');
                el.style.display = 'none';
                el.querySelectorAll('input, select').forEach(ctrl => {
                    if (ctrl.type === 'checkbox') ctrl.checked = false;
                    else ctrl.value = '';
                    ctrl.required = false;
                    ctrl.disabled = true;
                });
            } else {
                el.classList.remove('opacity-40');
                el.style.display = '';
                el.querySelectorAll('input, select').forEach(ctrl => {
                    ctrl.disabled = false;
                });
            }
        });
    }

    function fillAllVisibleControls(container) {
        const controls = Array.from(container.querySelectorAll('input, select'));
        let filled = 0;
        controls.forEach(el => {
            if (el.disabled) return;
            if (el.closest('[data-choice-selected="0"]')) return;
            if (el.closest('.hidden')) return;

            if (el.type === 'checkbox') {
                writeControl(el, 'true');
                filled++;
                return;
            }

            // Always overwrite in random mode so previous partial fills can't linger
            const meta = metaFromControl(el);
            writeControl(el, randomPrimitive(meta));
            // If the browser rejected the value (common on Windows for number/date/select), retry
            if (!isControlFilled(el)) {
                writeControl(el, safeFallbackValue(el, meta));
            }
            if (isControlFilled(el)) filled++;
        });
        return filled;
    }

    function isControlFilled(el) {
        if (!el || el.disabled) return true;
        if (el.type === 'checkbox') return true;
        return String(el.value || '').trim() !== '';
    }

    function safeFallbackValue(el, meta) {
        if (el.tagName === 'SELECT') {
            const opts = Array.from(el.options).map(o => o.value).filter(v => v !== '');
            if (opts.length) return opts[0];
        }
        const type = (meta && meta.type ? meta.type : el.type || 'string').toLowerCase();
        if (type === 'number' || type === 'integer' || el.type === 'number') {
            return randomBoundedInteger(meta || {});
        }
        if (type === 'decimal') return randomBoundedDecimal(meta || {});
        if (type === 'date' || el.type === 'date') return formatDate(randomDateNearToday(30));
        if (type === 'datetime' || el.type === 'datetime-local') {
            const d = randomDateNearToday(30);
            return `${formatDate(d)}T12:00`;
        }
        if (type === 'time' || el.type === 'time') return '12:00';
        if (type === 'gyearmonth' || el.type === 'month') {
            return `${randInt(2020, 2030)}-${String(randInt(1, 12)).padStart(2, '0')}`;
        }
        if (meta && meta.pattern) return valueFromPattern(meta.pattern, meta);
        if (meta && (meta.length || meta.maxLength)) {
            const len = meta.length || Math.min(Number(meta.maxLength), 4);
            return randomAlphaNum(len, true);
        }
        return 'X' + randInt(10, 99);
    }

    /** Final sweep used on Windows where some controls stay blank after the first pass. */
    function forceFillStillBlankControls(container) {
        Array.from(container.querySelectorAll('input, select')).forEach(el => {
            if (el.disabled) return;
            if (el.closest('[data-choice-selected="0"]')) return;
            if (el.closest('.hidden')) return;
            if (isControlFilled(el) && el.type !== 'checkbox') return;
            if (el.type === 'checkbox') {
                writeControl(el, 'true');
                return;
            }
            const meta = metaFromControl(el);
            writeControl(el, randomPrimitive(meta));
            if (!isControlFilled(el)) writeControl(el, safeFallbackValue(el, meta));
            // Last resort: switch number/date inputs to text so the value can stick
            if (!isControlFilled(el) && el.tagName === 'INPUT' && el.type !== 'text' && el.type !== 'checkbox') {
                const v = safeFallbackValue(el, meta);
                try { el.type = 'text'; } catch (_) { /* ignore */ }
                writeControl(el, v);
            }
        });
    }

    function metaFromControl(el) {
        const meta = {
            name: el.dataset.fieldName || el.dataset.attrName || 'Value',
            type: el.dataset.xsdType || 'string',
            pattern: el.dataset.xsdPattern || null,
            typeName: el.dataset.xsdTypeName || null,
            path: el.dataset.path || ''
        };
        if (el.dataset.xsdMaxLength) meta.maxLength = Number(el.dataset.xsdMaxLength);
        if (el.dataset.xsdMinLength) meta.minLength = Number(el.dataset.xsdMinLength);
        if (el.dataset.xsdLength) meta.length = Number(el.dataset.xsdLength);
        if (el.dataset.xsdFractionDigits != null && el.dataset.xsdFractionDigits !== '') {
            meta.fractionDigits = Number(el.dataset.xsdFractionDigits);
        }
        if (el.dataset.xsdTotalDigits) meta.totalDigits = Number(el.dataset.xsdTotalDigits);
        if (el.dataset.xsdWildcard === '1') meta.wildcard = true;
        if (el.dataset.xsdEnums) {
            try { meta.enumerations = JSON.parse(el.dataset.xsdEnums); } catch (_) { meta.enumerations = []; }
        } else {
            // Fall back to <select> options
            if (el.tagName === 'SELECT') {
                meta.enumerations = Array.from(el.options)
                    .map(o => o.value)
                    .filter(v => v !== '');
                if (meta.enumerations.length) meta.type = 'enumeration';
            }
        }
        return meta;
    }

    function stampFieldMeta(el, field) {
        if (!el || !field) return;
        el.dataset.xsdType = field.type || 'string';
        if (field.typeName) el.dataset.xsdTypeName = field.typeName;
        if (field.pattern) el.dataset.xsdPattern = field.pattern;
        if (field.maxLength != null) el.dataset.xsdMaxLength = String(field.maxLength);
        if (field.minLength != null) el.dataset.xsdMinLength = String(field.minLength);
        if (field.length != null) el.dataset.xsdLength = String(field.length);
        if (field.fractionDigits != null) el.dataset.xsdFractionDigits = String(field.fractionDigits);
        if (field.totalDigits != null) el.dataset.xsdTotalDigits = String(field.totalDigits);
        if (field.wildcard) el.dataset.xsdWildcard = '1';
        if (field.enumerations && field.enumerations.length) {
            el.dataset.xsdEnums = JSON.stringify(field.enumerations);
        }
    }

    /**
     * Kept for payload building / tests — still used conceptually for choice selection in collect.
     */
    function buildRandomForField(field, forceInclude) {
        const min = Math.max(0, Number(field.minOccurs) || 0);
        let maxRaw = field.maxOccurs === -1 ? 3 : Number(field.maxOccurs);
        if (!Number.isFinite(maxRaw) || maxRaw < 1) maxRaw = 1;
        const max = Math.max(Math.max(min, 1), Math.min(maxRaw, 3));
        const repeatable = !!(field.repeatable || field.maxOccurs === -1 || Number(field.maxOccurs) > 1);

        if (repeatable) {
            const count = forceInclude
                ? randInt(Math.max(min, 1), max)
                : (min >= 1 ? randInt(min, max) : (Math.random() < 0.7 ? randInt(1, max) : 0));
            if (count === 0) return [];
            const items = [];
            for (let i = 0; i < count; i++) {
                items.push(buildSingleRandomValue(field, true));
            }
            return items;
        }

        if (!forceInclude && min === 0 && Math.random() < 0.25) {
            return null;
        }
        return buildSingleRandomValue(field, forceInclude);
    }

    function buildSingleRandomValue(field, forceIncludeChildren) {
        if (field.complex) {
            const obj = {};
            const selected = selectChoiceChildren(field.children || []);
            selected.forEach(child => {
                const childVal = buildRandomForField(child, forceIncludeChildren !== false);
                if (childVal === null || childVal === undefined) return;
                if (Array.isArray(childVal) && childVal.length === 0) return;
                obj[child.name] = childVal;
            });
            return obj;
        }

        const text = randomPrimitive(field);
        if (field.attributes && field.attributes.length) {
            const attrs = {};
            field.attributes.forEach(attr => {
                attrs[attr.name] = randomPrimitive(attr);
            });
            return { _text: text, _attrs: attrs };
        }
        return text;
    }

    /** Pick children respecting xs:choice — one branch per choiceGroup. */
    function selectChoiceChildren(children) {
        const chosenBranchByGroup = new Map();
        const result = [];

        children.forEach(child => {
            if (!child.choiceGroup) return;
            if (chosenBranchByGroup.has(child.choiceGroup)) return;
            const branches = [...new Set(
                children
                    .filter(c => c.choiceGroup === child.choiceGroup)
                    .map(c => c.choiceBranch == null ? 0 : c.choiceBranch)
            )];
            const pick = branches[randInt(0, branches.length - 1)];
            chosenBranchByGroup.set(child.choiceGroup, pick);
        });

        children.forEach(child => {
            if (!child.choiceGroup) {
                result.push(child);
                return;
            }
            const branch = child.choiceBranch == null ? 0 : child.choiceBranch;
            if (chosenBranchByGroup.get(child.choiceGroup) === branch) {
                result.push(child);
            }
        });
        return result;
    }

    function randomPrimitive(field) {
        const type = (field.type || 'string').toLowerCase();
        const enums = field.enumerations || [];
        const paymentValue = paymentContextValue(field);
        if (paymentValue != null) return clampToLength(paymentValue, field);
        const contextual = countryContextValue(field, enums);
        if (contextual != null) return clampToLength(contextual, field);

        if (type === 'enumeration' || enums.length > 0) {
            if (!enums.length) return clampToLength('A', field);
            return clampToLength(enums[randInt(0, enums.length - 1)], field);
        }
        if (type === 'boolean') {
            return 'true';
        }
        if (type === 'gyearmonth') {
            return `${randInt(2020, 2030)}-${String(randInt(1, 12)).padStart(2, '0')}`;
        }
        if (type === 'gyear') {
            return String(randInt(2020, 2030));
        }
        if (type === 'gmonth') {
            return `--${String(randInt(1, 12)).padStart(2, '0')}`;
        }
        if (type === 'gday') {
            return `---${String(randInt(1, 28)).padStart(2, '0')}`;
        }
        if (type === 'any' || field.wildcard) {
            return 'auto-generated';
        }
        if (type === 'date') {
            return formatDate(randomDateNearToday(365));
        }
        if (type === 'datetime') {
            const d = randomDateNearToday(365);
            const hh = String(randInt(0, 23)).padStart(2, '0');
            const mm = String(randInt(0, 59)).padStart(2, '0');
            const ss = String(randInt(0, 59)).padStart(2, '0');
            return `${formatDate(d)}T${hh}:${mm}:${ss}`;
        }
        if (type === 'time') {
            return `${String(randInt(0, 23)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}`;
        }

        // Patterns must win over generic integer/decimal/alpha fallbacks
        if (field.pattern) {
            return valueFromPattern(field.pattern, field);
        }

        if (type === 'integer') {
            return randomBoundedInteger(field);
        }
        if (type === 'decimal') {
            return randomBoundedDecimal(field);
        }

        if (field.length || field.maxLength) {
            const len = field.length || Math.min(Number(field.maxLength), 4);
            return randomAlphaNum(len, true);
        }

        const token = (field.name || 'Value').replace(/[^a-zA-Z0-9]/g, '');
        return clampToLength(`${token || 'Value'}${randInt(10, 99)}`, field);
    }

    const COUNTRY_CURRENCIES = {
        AE: 'AED', AU: 'AUD', BR: 'BRL', CA: 'CAD', CH: 'CHF', CN: 'CNY',
        CZ: 'CZK', DK: 'DKK', GB: 'GBP', HK: 'HKD', HU: 'HUF', ID: 'IDR',
        IL: 'ILS', IN: 'INR', JP: 'JPY', KR: 'KRW', MX: 'MXN', MY: 'MYR',
        NO: 'NOK', NZ: 'NZD', PH: 'PHP', PL: 'PLN', RO: 'RON', RU: 'RUB',
        SA: 'SAR', SE: 'SEK', SG: 'SGD', TH: 'THB', TR: 'TRY', TW: 'TWD',
        US: 'USD', VN: 'VND', ZA: 'ZAR',
        AT: 'EUR', BE: 'EUR', DE: 'EUR', ES: 'EUR', FI: 'EUR', FR: 'EUR',
        GR: 'EUR', IE: 'EUR', IT: 'EUR', LU: 'EUR', NL: 'EUR', PT: 'EUR'
    };

    function getCountryCode() {
        const code = String(els.countryCode.value || '').trim().toUpperCase();
        return /^[A-Z]{2}$/.test(code) ? code : '';
    }

    function countryContextValue(field, enums) {
        const country = getCountryCode();
        if (!country) return null;
        const currency = COUNTRY_CURRENCIES[country];
        const name = String(field.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        const typeName = String(field.typeName || '').toLowerCase();
        const isCountry = /^(ctry|country|countrycode|ctrycode)$/.test(name)
            || /(countrycode|countryidentification|countryalpha2)/.test(typeName)
            || /(ctry|country)$/.test(name);
        const isCurrency = /^(ccy|currency|currencycode|ccycode)$/.test(name)
            || /(currencycode|activecurrency|currencyalpha3)/.test(typeName)
            || /(ccy|currency)$/.test(name);
        const candidate = isCountry ? country : (isCurrency ? currency : null);
        if (!candidate) return null;
        return enums.length === 0 || enums.includes(candidate) ? candidate : null;
    }

    function applyCountryContextToForm() {
        if (!getCountryCode()) return;
        els.dynamicForm.querySelectorAll('input, select').forEach(control => {
            if (control.disabled) return;
            const meta = metaFromControl(control);
            const contextual = countryContextValue(meta, meta.enumerations || []);
            if (contextual != null) writeControl(control, contextual);
        });
    }

    function paymentContextValue(field) {
        const path = String(field.path || field.name || '');
        const parts = path.split('.').filter(Boolean);
        const normalized = parts.map(part => part.replace(/[^a-z0-9]/gi, '').toLowerCase());
        const leaf = normalized[normalized.length - 1] || '';
        const contexts = [
            { segment: 'cdtragt', input: els.cdtrAgtValue, leaves: ['cdtragt', 'bicfi', 'bic', 'id'] },
            { segment: 'dbtragt', input: els.dbtrAgtValue, leaves: ['dbtragt', 'bicfi', 'bic', 'id'] },
            { segment: 'dbtracct', input: els.dbtrAcctValue, leaves: ['dbtracct', 'iban', 'id'] },
            { segment: 'cdtracct', input: els.cdtrAcctValue, leaves: ['cdtracct', 'iban', 'id'] }
        ];
        for (const context of contexts) {
            const value = String(context.input.value || '').trim();
            if (value && normalized.includes(context.segment) && context.leaves.includes(leaf)) {
                return value;
            }
        }
        return null;
    }

    function applyPaymentContextToForm() {
        els.dynamicForm.querySelectorAll('input, select').forEach(control => {
            if (control.disabled) return;
            const contextual = paymentContextValue(metaFromControl(control));
            if (contextual != null) writeControl(control, contextual);
        });
    }

    function updateCountryContextHint() {
        const country = getCountryCode();
        if (!country) {
            els.countryContextHint.textContent = 'Country and currency fields will use this context (HK → HKD).';
            return;
        }
        const currency = COUNTRY_CURRENCIES[country];
        els.countryContextHint.textContent = currency
            ? `Generated country fields: ${country}; currency fields: ${currency}.`
            : `Generated country fields: ${country}. No currency mapping is configured for this country.`;
    }

    function randomBoundedInteger(field) {
        const maxDigits = field.totalDigits != null ? Math.min(Number(field.totalDigits), 9)
            : (field.maxLength != null ? Math.min(Number(field.maxLength), 9) : 5);
        const minDigits = field.minLength != null ? Number(field.minLength) : 1;
        return randomDigits(Math.max(1, minDigits), Math.max(1, maxDigits));
    }

    function randomBoundedDecimal(field) {
        const total = field.totalDigits != null ? Number(field.totalDigits) : 11;
        let frac = field.fractionDigits != null ? Number(field.fractionDigits) : 2;
        if (frac < 0) frac = 0;
        if (frac >= total) frac = Math.max(0, total - 1);
        const intDigits = Math.max(1, total - frac);
        const intPart = randomDigits(1, Math.min(intDigits, 6)).replace(/^0+/, '') || '1';
        // Trim integer part to allowed digits
        const intTrimmed = intPart.length > intDigits ? intPart.slice(0, intDigits) : intPart;
        if (frac === 0) return intTrimmed;
        const fracPart = randomDigits(frac, frac);
        return intTrimmed + '.' + fracPart;
    }

    /**
     * Generate a value that satisfies common XSD pattern facets (ISO 20022 numeric/alpha forms).
     */
    function valueFromPattern(pattern, field) {
        let p = String(pattern || '').trim();
        // Normalize common escapes from Xerces lexical form
        p = p.replace(/\\d/g, '[0-9]');

        // Try to synthesize from a sequence of simple character-class quantifiers
        const synthesized = synthesizeFromPatternTokens(p);
        if (synthesized != null) return synthesized;

        // Country / currency / BIC / IBAN shortcuts
        if (/^\[A-Z\]\{2(?:,2)?\}$/.test(p)) return getCountryCode() || pick(['US', 'GB', 'DE', 'FR', 'IN', 'NL', 'IE', 'CH']);
        if (/^\[A-Z\]\{3(?:,3)?\}$/.test(p)) {
            const c = getCountryCode();
            return (c && COUNTRY_CURRENCIES[c]) || pick(['USD', 'EUR', 'GBP', 'INR', 'CHF', 'JPY']);
        }
        // UETR / UUID v4 used by pacs.008
        if (/\[a-f0-9\]\{8\}-\[a-f0-9\]\{4\}-4\[a-f0-9\]/.test(p) || /uuid|uetr/i.test(field.typeName || '') || /^uetr$/i.test(field.name || '')) {
            const h = () => 'xxxxxxxx'.replace(/x/g, () => pick('abcdef0123456789'.split('')));
            return `${h().slice(0,8)}-${h().slice(0,4)}-4${h().slice(0,3)}-${pick(['8','9','a','b'])}${h().slice(0,3)}-${h()}${h().slice(0,4)}`;
        }
        // BIC / BICFI (ISO 20022) — 8 or 11 chars
        if (/\[A-Z0-9\]\{4,4\}\[A-Z\]\{2,2\}\[A-Z0-9\]\{2,2\}/.test(p)
            || /bicfi|bic/i.test(field.typeName || '')
            || /^(bicfi|bic)$/i.test(field.name || '')) {
            return pick(['CHASUS33XXX', 'COBADEFFXXX', 'DEUTDEFFXXX', 'HSBCHKHHXXX', 'BNPAFRPPXXX']);
        }
        if (/\[A-Z\]\{6,6\}\[A-Z2-9\]/.test(p)) {
            return pick(['CHASUS33', 'DEUTDEFF', 'BNPAFRPP', 'BARCGB22', 'HDFCINBB']);
        }
        if (/\[A-Z\]\{2,2\}\[0-9\]\{2,2\}\[a-zA-Z0-9\]/.test(p)
            || /iban/i.test(field.typeName || '')
            || /^iban$/i.test(field.name || '')) {
            return pick(['GB82WEST12345698765432', 'DE89370400440532013000', 'FR1420041010050500013M02606']);
        }
        if (/phone|PhoneNumber/i.test(field.typeName || '') || (/\\\+\[0-9\]\{1,3\}/.test(p) && p.includes('-'))) {
            return '+1-5551234567';
        }

        // Pure digit patterns already handled by tokenizer; last resort numeric if pattern is digit-ish
        if (/\[0-9\]/.test(p) && !/[A-Za-z]/.test(p.replace(/\[0-9\]/g, ''))) {
            const bounds = extractDigitBounds(p);
            return randomDigits(bounds.min, bounds.max);
        }

        // Alphanumeric exact/range
        let m;
        if ((m = /^\[A-Z0-9\]\{(\d+)(?:,\1)?\}$/i.exec(p))) return randomAlphaNum(Number(m[1]), true);
        if ((m = /^\[a-zA-Z0-9\]\{(\d+)(?:,\1)?\}$/.exec(p))) return randomAlphaNum(Number(m[1]), false);
        if ((m = /^\[A-Z0-9\]\{(\d+),(\d+)\}$/i.exec(p))) return randomAlphaNum(randInt(Number(m[1]), Number(m[2])), true);
        if ((m = /^\[a-zA-Z0-9\]\{(\d+),(\d+)\}$/.exec(p))) return randomAlphaNum(randInt(Number(m[1]), Number(m[2])), false);
        if ((m = /^\[A-Z\]\{(\d+)(?:,\1)?\}$/.exec(p))) return randomAlpha(Number(m[1])).toUpperCase();
        if ((m = /^\[A-Z\]\{(\d+),(\d+)\}$/.exec(p))) return randomAlpha(randInt(Number(m[1]), Number(m[2]))).toUpperCase();

        if (field.length) return randomAlphaNum(Number(field.length), true);
        if (field.maxLength) return randomAlphaNum(Math.min(Number(field.maxLength), 8), true);
        return randomAlphaNum(4, true);
    }

    /**
     * Parse patterns like: [0-9]{1,5} | [0-9]{3} | [0-9] | [\+]{0,1}[0-9]{1,15} | [A-Z0-9]{12,12}
     */
    function synthesizeFromPatternTokens(pattern) {
        const tokenRe = /\\?\[\s*((?:\\\]|[^\]])*)\](?:\{(\d+)(?:,(\d+))?\})?|\\([dDwWsS])/g;
        let match;
        const parts = [];
        let cursor = 0;
        const p = pattern;

        while ((match = tokenRe.exec(p)) !== null) {
            if (match.index !== cursor) {
                // Unsupported literal/gap — abort synthesis
                return null;
            }
            cursor = match.index + match[0].length;

            if (match[4]) {
                // \d etc
                const esc = match[4];
                const min = 1, max = 1;
                if (esc === 'd') parts.push(randomDigits(min, max));
                else if (esc === 'w') parts.push(randomAlphaNum(1, false));
                else return null;
                continue;
            }

            const cls = match[1].replace(/\\(.)/g, '$1'); // unwrap escapes inside class
            const minQ = match[2] != null ? Number(match[2]) : 1;
            const maxQ = match[3] != null ? Number(match[3]) : (match[2] != null ? Number(match[2]) : 1);
            const count = randInt(minQ, Math.max(minQ, maxQ));

            if (count === 0) {
                parts.push('');
                continue;
            }

            if (isDigitClass(cls)) {
                parts.push(randomDigits(count, count));
            } else if (isSignedPlusOptionalClass(cls) && count <= 1) {
                // [\+]{0,1} — usually omit the plus for simplicity
                parts.push(minQ === 0 ? '' : '+');
            } else if (isUpperAlnumClass(cls)) {
                parts.push(randomAlphaNum(count, true));
            } else if (isAlnumClass(cls)) {
                parts.push(randomAlphaNum(count, false));
            } else if (isUpperAlphaClass(cls)) {
                parts.push(randomAlpha(count).toUpperCase());
            } else if (cls === '+' || cls === '\\+') {
                parts.push('+');
            } else {
                return null;
            }
        }

        if (cursor !== p.length) return null;
        if (!parts.length) return null;
        const value = parts.join('');
        return value === '' ? '1' : value;
    }

    function isDigitClass(cls) {
        return cls === '0-9' || cls === '\\d' || /^0-9$/.test(cls);
    }

    function isSignedPlusOptionalClass(cls) {
        // matches +, \+, or + with other junk from [\+]
        return cls === '+' || cls === '\\+' || cls.replace(/\\/g, '') === '+';
    }

    function isUpperAlnumClass(cls) {
        return cls === 'A-Z0-9' || cls === '0-9A-Z' || /^A-Z0-9$/.test(cls);
    }

    function isAlnumClass(cls) {
        return cls === 'a-zA-Z0-9' || cls === 'A-Za-z0-9' || /a-zA-Z0-9/.test(cls) && !cls.includes('^');
    }

    function isUpperAlphaClass(cls) {
        return cls === 'A-Z' || /^A-Z$/.test(cls);
    }

    function extractDigitBounds(pattern) {
        let m;
        if ((m = /\[0-9\]\{(\d+),(\d+)\}/.exec(pattern))) {
            return { min: Number(m[1]), max: Number(m[2]) };
        }
        if ((m = /\[0-9\]\{(\d+)\}/.exec(pattern))) {
            return { min: Number(m[1]), max: Number(m[1]) };
        }
        if (/\[0-9\]/.test(pattern)) {
            return { min: 1, max: 1 };
        }
        return { min: 1, max: 5 };
    }

    function randomAlphaNum(len, upperOnly) {
        const chars = upperOnly
            ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
            : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let s = '';
        for (let i = 0; i < len; i++) s += chars.charAt(randInt(0, chars.length - 1));
        return s;
    }

    function clampToLength(value, field) {
        let v = String(value == null ? '' : value);
        if (field.length != null) {
            if (v.length > field.length) v = v.slice(0, field.length);
            while (v.length < field.length) v += 'X';
            return v;
        }
        if (field.maxLength != null && v.length > field.maxLength) {
            v = v.slice(0, field.maxLength);
        }
        if (field.minLength != null && v.length < field.minLength) {
            while (v.length < field.minLength) v += '0';
        }
        return v;
    }

    function randomDigits(minLen, maxLen) {
        const len = randInt(minLen, maxLen);
        let s = '';
        for (let i = 0; i < len; i++) s += String(randInt(0, 9));
        return s || '1';
    }

    function randomAlpha(len) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let s = '';
        for (let i = 0; i < len; i++) s += chars.charAt(randInt(0, chars.length - 1));
        return s;
    }

    function pick(arr) {
        return arr[randInt(0, arr.length - 1)];
    }

    function applyValuesToForm(field, value, container, parentPath) {
        if (!field || value == null || !container) return;

        const currentPath = parentPath ? parentPath + '.' + field.name : field.name;

        if (field.complex) {
            if (Array.isArray(value)) return;
            (field.children || []).forEach(child => {
                const childVal = value[child.name];
                if (childVal == null) return;
                applyChildToForm(child, childVal, container, currentPath);
            });
            return;
        }

        const textValues = [];
        let attrs = null;
        if (value && typeof value === 'object' && !Array.isArray(value) && (value._text != null || value._attrs)) {
            textValues.push(value._text != null ? value._text : '');
            attrs = value._attrs || null;
        } else if (Array.isArray(value)) {
            value.forEach(v => {
                if (v && typeof v === 'object' && v._text != null) textValues.push(v._text);
                else textValues.push(v);
            });
            if (value[0] && value[0]._attrs) attrs = value[0]._attrs;
        } else {
            textValues.push(value);
        }

        setSimpleControls(container, field.name, textValues, currentPath);
        if (attrs && field.attributes) {
            applyAttributeControls(container, field, attrs, currentPath);
        }
    }

    function applyAttributeControls(container, field, attrs, path) {
        const wrap = findByExactAttr(container, 'data-path', path)
            || findDirectSimpleField(container, field.name);
        if (!wrap) return;
        Object.keys(attrs).forEach(name => {
            const input = wrap.querySelector(`[data-attr-name="${cssEscape(name)}"]`);
            if (input) writeControl(input, attrs[name]);
        });
    }

    function applyChildToForm(child, childVal, container, parentPath) {
        const path = parentPath + '.' + child.name;

        if (child.complex) {
            const host = findByExactAttr(container, 'data-repeat-host', path)
                || findNearestFieldHost(container, child.name);
            if (!host) {
                console.warn('Random fill: missing complex host for', path);
                return;
            }

            const items = Array.isArray(childVal) ? childVal : [childVal];
            ensureComplexInstances(host, child, path, items.length);
            const instances = Array.from(host.children).filter(el => el.dataset && el.dataset.instance === 'true');
            items.forEach((item, idx) => {
                if (instances[idx]) {
                    applyValuesToForm(child, item, instances[idx], parentPath);
                }
            });
            return;
        }

        const wrap = findByExactAttr(container, 'data-path', path)
            || findDirectSimpleField(container, child.name);
        if (!wrap) {
            console.warn('Random fill: missing simple field for', path);
            return;
        }
        const values = Array.isArray(childVal) ? childVal : [childVal];
        ensureSimpleRows(wrap, child, path, values.length);
        setSimpleControls(wrap, child.name, values, path);
    }

    /** Match attribute by exact value — do NOT use CSS.escape (it breaks dots in paths). */
    function findByExactAttr(container, attrName, value) {
        if (!container) return null;
        const nodes = container.querySelectorAll('[' + attrName + ']');
        for (const el of nodes) {
            if (el.getAttribute(attrName) === value) return el;
        }
        return null;
    }

    function findNearestFieldHost(container, fieldName) {
        const nodes = container.querySelectorAll('[data-field-name], [data-repeat-host]');
        for (const el of nodes) {
            if (el.getAttribute('data-field-name') === fieldName) return el;
            const host = el.getAttribute('data-repeat-host') || '';
            if (host === fieldName || host.endsWith('.' + fieldName)) return el;
        }
        return null;
    }

    /** Find a simple-field wrapper that belongs to this container scope (not a nested complex's child). */
    function findDirectSimpleField(container, fieldName) {
        const candidates = Array.from(container.querySelectorAll('[data-simple-field]'))
            .filter(el => el.getAttribute('data-simple-field') === fieldName);

        // Prefer a field that is not inside a nested [data-instance] deeper than this container
        for (const el of candidates) {
            const nestedInstance = el.closest('[data-instance="true"]');
            if (!nestedInstance || nestedInstance === container || container.contains(nestedInstance) && !hasIntermediateInstance(container, el)) {
                // If container itself is an instance, accept fields inside it
                if (container.dataset && container.dataset.instance === 'true') {
                    if (nestedInstance === container || container.contains(el)) return el;
                }
            }
        }

        // Fallback: first match inside container
        return candidates.find(el => container.contains(el)) || null;
    }

    function hasIntermediateInstance(container, el) {
        let node = el.parentElement;
        while (node && node !== container) {
            if (node.dataset && node.dataset.instance === 'true' && node !== container) return true;
            node = node.parentElement;
        }
        return false;
    }

    function ensureComplexInstances(host, field, path, needed) {
        while (Array.from(host.children).filter(el => el.dataset && el.dataset.instance === 'true').length < needed) {
            const instance = document.createElement('div');
            instance.className = 'space-y-3 pl-1 border-l-2 border-slate-100';
            instance.dataset.instance = 'true';
            (field.children || []).forEach(child => instance.appendChild(renderField(child, path)));
            host.appendChild(instance);
        }
    }

    function ensureSimpleRows(wrap, field, path, needed) {
        let list = findByExactAttr(wrap, 'data-repeat-simple', path)
            || wrap.querySelector('[data-repeat-simple]');
        if (!list) return;
        const template = list.querySelector('input, select');
        if (!template) return;
        while (list.children.length < needed) {
            const r = document.createElement('div');
            r.className = 'flex gap-2 items-center';
            const clone = template.cloneNode(true);
            if (clone.type === 'checkbox') clone.checked = false;
            else clone.value = '';
            r.appendChild(clone);
            list.appendChild(r);
        }
    }

    function setSimpleControls(container, fieldName, values, path) {
        let wrap = container;
        if (!(container.getAttribute && container.getAttribute('data-simple-field') === fieldName)) {
            wrap = (path && findByExactAttr(container, 'data-path', path))
                || findDirectSimpleField(container, fieldName)
                || findByExactAttr(container, 'data-simple-field', fieldName);
        }
        if (!wrap) return;

        const list = wrap.querySelector('[data-repeat-simple]');
        const allControls = list
            ? Array.from(list.querySelectorAll('input:not([data-attr-name]), select:not([data-attr-name])'))
            : Array.from(wrap.querySelectorAll('input:not([data-attr-name]), select:not([data-attr-name])'));

        values.forEach((val, idx) => {
            const el = allControls[idx];
            if (!el) return;
            writeControl(el, val);
        });
    }

    function writeControl(el, val) {
        if (!el) return;
        if (el.type === 'checkbox') {
            el.checked = val === true || val === 'true';
        } else {
            let v = String(val == null ? '' : val);
            // datetime-local does not accept seconds
            if (el.type === 'datetime-local' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
                v = v.slice(0, 16);
            }
            if (el.type === 'month' && /^\d{4}-\d{2}/.test(v)) {
                v = v.slice(0, 7);
            }
            if (el.type === 'time' && /^\d{2}:\d{2}/.test(v)) {
                v = v.slice(0, 5);
            }
            if (el.tagName === 'SELECT') {
                const opts = Array.from(el.options).map(o => o.value);
                if (v && opts.indexOf(v) === -1) {
                    // Country/payment override may not be in enum — pick a valid option instead of leaving blank
                    const nonempty = opts.filter(o => o !== '');
                    v = nonempty.length ? nonempty[0] : '';
                }
            }
            if (el.type === 'number') {
                // Strip anything browsers reject (commas, trailing letters)
                const num = String(v).replace(/[^0-9.+-]/g, '');
                v = num === '' || num === '.' || num === '-' || num === '+' ? '1' : num;
            }
            el.value = v;
            // If the browser rejected it, leave empty so the blank-fill pass can recover
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /** Last-resort pass: generate a value for every still-empty control using nearby schema metadata. */
    function fillAnyRemainingBlankControls(root, container) {
        const byName = new Map();
        const choiceSelected = new Map(); // choiceGroup -> chosen branch from already-filled fields

        function indexField(field) {
            if (field.name) {
                if (!byName.has(field.name)) byName.set(field.name, field);
            }
            (field.children || []).forEach(indexField);
            (field.attributes || []).forEach(indexField);
        }
        indexField(root);

        // Detect which choice branches already have values
        container.querySelectorAll('[data-choice-group]').forEach(el => {
            const group = el.getAttribute('data-choice-group');
            const branch = el.getAttribute('data-choice-branch');
            if (!group) return;
            const hasValue = Array.from(el.querySelectorAll('input, select')).some(ctrl => {
                if (ctrl.type === 'checkbox') return ctrl.checked;
                return String(ctrl.value || '').trim() !== '';
            });
            if (hasValue && !choiceSelected.has(group)) {
                choiceSelected.set(group, branch == null ? '0' : branch);
            }
        });

        // Clear non-selected choice branches (simple + complex cards)
        container.querySelectorAll('[data-choice-group]').forEach(el => {
            const group = el.getAttribute('data-choice-group');
            const branch = el.getAttribute('data-choice-branch');
            if (!group || !choiceSelected.has(group)) return;
            if (choiceSelected.get(group) === (branch == null ? '0' : branch)) return;
            el.querySelectorAll('input, select').forEach(ctrl => {
                if (ctrl.type === 'checkbox') ctrl.checked = false;
                else ctrl.value = '';
                ctrl.required = false;
            });
        });

        container.querySelectorAll('[data-simple-field]').forEach(wrap => {
            const name = wrap.getAttribute('data-simple-field');
            const group = wrap.getAttribute('data-choice-group');
            const branch = wrap.getAttribute('data-choice-branch');
            if (group) {
                if (!choiceSelected.has(group)) {
                    choiceSelected.set(group, branch == null ? '0' : branch);
                } else if (choiceSelected.get(group) !== (branch == null ? '0' : branch)) {
                    return;
                }
            }

            const field = byName.get(name) || { name: name, type: 'string' };
            const controls = Array.from(wrap.querySelectorAll('input:not([data-attr-name]), select:not([data-attr-name])'));
            controls.forEach(el => {
                if (el.type === 'checkbox') {
                    if (!el.checked) writeControl(el, 'true');
                    return;
                }
                if (String(el.value || '').trim() !== '') return;
                writeControl(el, randomPrimitive(field));
            });

            // Required attributes
            (field.attributes || []).forEach(attr => {
                const input = wrap.querySelector(`[data-attr-name="${cssEscape(attr.name)}"]`);
                if (!input) return;
                if (String(input.value || '').trim() !== '') return;
                writeControl(input, randomPrimitive(attr));
            });
        });
    }

    function randInt(min, max) {
        if (max < min) max = min;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randomDateNearToday(spanDays) {
        const d = new Date();
        d.setDate(d.getDate() + randInt(-Math.floor(spanDays / 2), Math.floor(spanDays / 2)));
        return d;
    }

    function formatDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function isAllowedSchemaFile(file) {
        if (!file || !file.name) return false;
        const name = file.name.toLowerCase();
        return name.endsWith('.xsd') || name.endsWith('.xml') || name.endsWith('.zip');
    }

    function normalizeSchemaFileName(name) {
        const base = String(name || 'schema.xsd').split(/[/\\]/).pop();
        if (/\.xsd$/i.test(base) || /\.xml$/i.test(base) || /\.zip$/i.test(base)) return base;
        return base + '.xsd';
    }

    function buildPayload() {
        const root = state.roots[state.selectedRootIndex];
        if (!root) {
            setStatus(els.generateStatus, 'No schema loaded.', true);
            return null;
        }
        if (!state.schemaId) {
            setStatus(els.generateStatus, 'Missing schemaId. Please re-upload the XSD.', true);
            return null;
        }

        // HTML5 validation
        if (!els.dynamicForm.reportValidity()) {
            setStatus(els.generateStatus, 'Please fill all required fields.', true);
            return null;
        }

        const values = {};
        values[root.name] = collectComplexValues(root, els.dynamicForm);

        return {
            schemaId: state.schemaId,
            rootName: root.name,
            // Thin stub only — full tree is kept server-side (critical for pacs.008 size)
            schema: { name: root.name, namespace: root.namespace || null },
            values: values
        };
    }

    function showValidationErrors(data) {
        const errors = (data && Array.isArray(data.errors)) ? data.errors : [];
        if (!errors.length) {
            clearValidationErrors();
            return;
        }
        els.validationErrorList.innerHTML = errors
            .map(e => `<li>${escapeHtml(e)}</li>`)
            .join('');
        els.validationErrors.classList.remove('hidden');
    }

    function clearValidationErrors() {
        els.validationErrorList.innerHTML = '';
        els.validationErrors.classList.add('hidden');
    }

    function collectComplexValues(field, container) {
        if (!field.complex) {
            return readSimpleFieldValue(container, field);
        }

        const result = {};
        const selectedChildren = selectChoiceChildrenForCollect(field.children || [], container);

        selectedChildren.forEach(child => {
            if (child.complex) {
                if (child.repeatable || child.maxOccurs === -1 || child.maxOccurs > 1) {
                    const path = guessChildPath(container, field, child);
                    const host = (path && findByExactAttr(container, 'data-repeat-host', path))
                        || findNearestFieldHost(container, child.name);
                    const instances = host
                        ? Array.from(host.children).filter(el => el.dataset && el.dataset.instance === 'true')
                        : findDirectChildBlocks(container, child.name);
                    const items = instances.map(inst => collectComplexValues(child, inst)).filter(v => v && Object.keys(v).length);
                    if (items.length) result[child.name] = items;
                } else {
                    const path = guessChildPath(container, field, child);
                    const host = (path && findByExactAttr(container, 'data-repeat-host', path))
                        || findNearestFieldHost(container, child.name);
                    const instance = host
                        ? Array.from(host.children).find(el => el.dataset && el.dataset.instance === 'true')
                        : (findDirectChildBlocks(container, child.name)[0] || container);
                    const nested = collectComplexValues(child, instance || container);
                    if (nested && Object.keys(nested).length) result[child.name] = nested;
                }
            } else {
                const val = readSimpleFieldValue(container, child);
                if (val === null || val === '' || val === undefined) return;
                if (Array.isArray(val) && !val.length) return;
                if (typeof val === 'object' && val._text === '' && (!val._attrs || !Object.keys(val._attrs).length)) return;
                result[child.name] = val;
            }
        });
        return result;
    }

    function selectChoiceChildrenForCollect(children, container) {
        // Prefer branches locked by random-fill UI (data-choice-selected)
        const locked = new Map();
        container.querySelectorAll('[data-choice-group][data-choice-selected="1"]').forEach(el => {
            const g = el.getAttribute('data-choice-group');
            const b = el.getAttribute('data-choice-branch');
            if (g && !locked.has(g)) locked.set(g, b == null ? 0 : Number(b));
        });

        const chosen = new Map(locked);
        children.forEach(child => {
            if (!child.choiceGroup) return;
            if (chosen.has(child.choiceGroup)) return;
            const has = childHasAnyValue(container, child);
            if (has) {
                chosen.set(child.choiceGroup, child.choiceBranch == null ? 0 : child.choiceBranch);
            }
        });
        children.forEach(child => {
            if (!child.choiceGroup) return;
            if (!chosen.has(child.choiceGroup)) {
                chosen.set(child.choiceGroup, child.choiceBranch == null ? 0 : child.choiceBranch);
            }
        });

        return children.filter(child => {
            if (!child.choiceGroup) return true;
            const branch = child.choiceBranch == null ? 0 : child.choiceBranch;
            return chosen.get(child.choiceGroup) === branch;
        });
    }

    function childHasAnyValue(container, child) {
        if (child.complex) {
            const cards = findDirectChildBlocks(container, child.name);
            const scope = cards[0] || container;
            return Array.from(scope.querySelectorAll('input, select')).some(el => {
                if (el.type === 'checkbox') return el.checked;
                return String(el.value || '').trim() !== '';
            });
        }
        const wrap = findDirectSimpleField(container, child.name);
        if (!wrap) return false;
        return Array.from(wrap.querySelectorAll('input, select')).some(el => {
            if (el.type === 'checkbox') return el.checked;
            return String(el.value || '').trim() !== '';
        });
    }

    function guessChildPath(container, parentField, child) {
        // Try to infer from an existing path attribute in this container
        const sample = container.querySelector('[data-path]');
        if (sample) {
            const p = sample.getAttribute('data-path') || '';
            const parentPrefix = p.includes('.') ? p.split('.').slice(0, -1).join('.') : parentField.name;
            // If sample is sibling under same parent
            if (p.startsWith(parentField.name + '.') || p.includes('.' + parentField.name + '.')) {
                const idx = p.lastIndexOf('.' + parentField.name + '.');
                if (idx >= 0) {
                    return p.substring(0, idx + parentField.name.length + 1) + '.' + child.name;
                }
            }
            if (p.startsWith(parentField.name + '.')) {
                return parentField.name + '.' + child.name;
            }
        }
        return parentField.name + '.' + child.name;
    }

    function findDirectChildBlocks(container, name) {
        return Array.from(container.querySelectorAll('.nested-card')).filter(card => {
            if (!container.contains(card)) return false;
            // Prefer cards that are not nested deeper inside another nested-card under container
            const title = card.querySelector('p.font-medium');
            return title && title.textContent.includes('<' + name + '>');
        });
    }

    function readSimpleFieldValue(container, field) {
        const wrap = (container.getAttribute && container.getAttribute('data-simple-field') === field.name)
            ? container
            : findDirectSimpleField(container, field.name);
        if (!wrap) return '';

        const repeatList = wrap.querySelector('[data-repeat-simple]');
        let textVal;
        if (repeatList) {
            const vals = Array.from(repeatList.querySelectorAll('input, select'))
                .map(el => readControl(el))
                .filter(v => v !== null && v !== '');
            textVal = vals.length ? vals : '';
        } else {
            const control = wrap.querySelector('input:not([data-attr-name]), select:not([data-attr-name])');
            textVal = readControl(control);
        }

        if (field.attributes && field.attributes.length) {
            const attrs = {};
            field.attributes.forEach(attr => {
                const input = wrap.querySelector(`[data-attr-name="${cssEscape(attr.name)}"]`);
                const v = readControl(input);
                if (v !== null && v !== '') attrs[attr.name] = v;
            });
            if (Array.isArray(textVal)) {
                return textVal.map(t => ({ _text: t, _attrs: attrs }));
            }
            return { _text: textVal, _attrs: attrs };
        }
        return textVal;
    }

    function readSimpleValue(container, name) {
        return readSimpleFieldValue(container, { name: name });
    }

    function readControl(el) {
        if (!el || el.disabled) return '';
        if (el.type === 'checkbox') return el.checked ? 'true' : 'false';
        let v = el.value;
        // datetime-local omits seconds; xs:dateTime requires them
        if (el.type === 'datetime-local' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) {
            v = v + ':00';
        }
        return v;
    }

    function setStatus(el, message, isError) {
        el.textContent = message || '';
        el.className = 'text-sm ' + (isError ? 'text-rose-600' : 'text-slate-500');
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function cssEscape(value) {
        if (window.CSS && CSS.escape) return CSS.escape(value);
        return String(value).replace(/"/g, '\\"');
    }
})();
