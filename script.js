// --- 定数・初期データ ---
const STORAGE_KEY = 'kakeibo_data';
const THEME_KEY = 'kakeibo_theme';

const CATEGORIES = {
    expense: ['食費', '日用品', '交通費', '娯楽', '医療費', '固定費', 'その他'],
    income: ['給料', '副収入', 'その他']
};

// 状態管理
let records = [];
let editId = null;
let currentTheme = 'dark';
let pieChartInstance = null;
let barChartInstance = null;

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadData();
    setupEventListeners();
    updateUI();
});

function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) {
        currentTheme = savedTheme;
    } else {
        // OS設定をチェック
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            currentTheme = 'light';
        }
    }
    applyTheme();
}

function applyTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    const icon = document.querySelector('#themeToggleBtn i');
    if (currentTheme === 'light') {
        icon.className = 'fa-solid fa-sun';
    } else {
        icon.className = 'fa-solid fa-moon';
    }
    // グラフの再描画（色をテーマに合わせるため）
    if (pieChartInstance) updateCharts();
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, currentTheme);
    applyTheme();
}

function loadData() {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
        try {
            records = JSON.parse(data);
            // 日付で降順ソート
            records.sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (e) {
            console.error('データの読み込みに失敗しました', e);
            records = [];
        }
    } else {
        records = [];
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

// --- イベントリスナー設定 ---
function setupEventListeners() {
    // テーマ切り替え
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // ナビゲーション切り替え
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget.dataset.target;
            switchPage(target);
            
            // 下部ナビゲーションのアクティブ状態更新
            navBtns.forEach(b => b.classList.remove('active'));
            if(target !== 'add') {
               e.currentTarget.classList.add('active');
            }
        });
    });

    // フォーム関連
    document.getElementById('recordForm').addEventListener('submit', handleFormSubmit);
    
    document.getElementById('typeExpense').addEventListener('change', updateCategorySelect);
    document.getElementById('typeIncome').addEventListener('change', updateCategorySelect);
    
    document.getElementById('cancelEditBtn').addEventListener('click', resetForm);

    // フィルター関連
    document.getElementById('filterMonth').addEventListener('change', renderHistory);
    document.getElementById('filterType').addEventListener('change', () => {
        updateFilterCategorySelect();
        renderHistory();
    });
    document.getElementById('filterCategory').addEventListener('change', renderHistory);
    document.getElementById('resetFilterBtn').addEventListener('click', () => {
        document.getElementById('filterMonth').value = '';
        document.getElementById('filterType').value = 'all';
        updateFilterCategorySelect();
        renderHistory();
    });

    // エクスポート / インポート
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', importData);

    // 初期化時にカテゴリセレクトボックスを更新
    updateCategorySelect();
    updateFilterCategorySelect();

    // 今月をフィルターのデフォルトに
    const today = new Date();
    document.getElementById('filterMonth').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(pageId).classList.add('active');

    // ページごとの更新処理
    if (pageId === 'home') {
        renderHome();
    } else if (pageId === 'history') {
        renderHistory();
    }
}

// --- UI更新処理 ---
function updateUI() {
    renderHome();
    renderHistory();
}

// ホーム画面の描画
function renderHome() {
    const today = new Date();
    const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    document.getElementById('currentMonthTitle').textContent = `${today.getFullYear()}年${today.getMonth() + 1}月`;

    // 今月のデータを集計
    let income = 0;
    let expense = 0;

    records.forEach(record => {
        if (record.date.startsWith(currentYearMonth)) {
            if (record.type === 'income') {
                income += Number(record.amount);
            } else {
                expense += Number(record.amount);
            }
        }
    });

    const total = income - expense;

    document.getElementById('summaryIncome').textContent = `${income.toLocaleString()}円`;
    document.getElementById('summaryExpense').textContent = `${expense.toLocaleString()}円`;
    
    const totalEl = document.getElementById('summaryTotal');
    totalEl.textContent = `${total > 0 ? '+' : ''}${total.toLocaleString()}円`;
    totalEl.style.color = total >= 0 ? 'var(--income)' : 'var(--expense)';

    updateCharts();
}

// 履歴一覧の描画
function renderHistory() {
    const listEl = document.getElementById('historyList');
    listEl.innerHTML = '';

    const filterMonth = document.getElementById('filterMonth').value;
    const filterType = document.getElementById('filterType').value;
    const filterCategory = document.getElementById('filterCategory').value;

    let filteredRecords = records;

    if (filterMonth) {
        filteredRecords = filteredRecords.filter(r => r.date.startsWith(filterMonth));
    }
    if (filterType !== 'all') {
        filteredRecords = filteredRecords.filter(r => r.type === filterType);
    }
    if (filterCategory !== 'all') {
        filteredRecords = filteredRecords.filter(r => r.category === filterCategory);
    }

    if (filteredRecords.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-folder-open"></i>
                <p>記録がありません</p>
            </div>
        `;
        return;
    }

    filteredRecords.forEach(record => {
        const item = document.createElement('div');
        item.className = `history-item is-${record.type}`;
        
        const isExpense = record.type === 'expense';
        const sign = isExpense ? '-' : '+';
        const dateStr = new Date(record.date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });

        item.innerHTML = `
            <div class="history-info">
                <div class="history-cat">${record.category}</div>
                <div class="history-meta">
                    <span><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
                    ${record.memo ? `<span><i class="fa-regular fa-comment"></i> ${record.memo}</span>` : ''}
                </div>
            </div>
            <div class="history-amount">${sign}${Number(record.amount).toLocaleString()}円</div>
            <div class="history-actions">
                <button class="action-btn" onclick="editRecord('${record.id}')"><i class="fa-solid fa-pen"></i></button>
                <button class="action-btn delete" onclick="deleteRecord('${record.id}')"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        listEl.appendChild(item);
    });
}

// フォームのカテゴリ更新
function updateCategorySelect() {
    const type = document.querySelector('input[name="recordType"]:checked').value;
    const select = document.getElementById('recordCategory');
    select.innerHTML = '';
    
    CATEGORIES[type].forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        select.appendChild(option);
    });
}

function updateFilterCategorySelect() {
    const type = document.getElementById('filterType').value;
    const select = document.getElementById('filterCategory');
    select.innerHTML = '<option value="all">すべて</option>';
    
    let cats = [];
    if (type === 'all') {
        cats = [...CATEGORIES.expense, ...CATEGORIES.income];
        // 重複削除
        cats = [...new Set(cats)];
    } else {
        cats = CATEGORIES[type];
    }
    
    cats.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        select.appendChild(option);
    });
}

// --- CRUD処理 ---
function handleFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('recordId').value || crypto.randomUUID();
    const date = document.getElementById('recordDate').value;
    const type = document.querySelector('input[name="recordType"]:checked').value;
    const amount = document.getElementById('recordAmount').value;
    const category = document.getElementById('recordCategory').value;
    const memo = document.getElementById('recordMemo').value;

    const newRecord = { id, date, type, amount, category, memo };

    if (editId) {
        const index = records.findIndex(r => r.id === editId);
        if (index !== -1) {
            records[index] = newRecord;
        }
        showToast('更新しました');
    } else {
        records.push(newRecord);
        showToast('登録しました');
    }

    records.sort((a, b) => new Date(b.date) - new Date(a.date));
    saveData();
    resetForm();
    updateUI();
    
    // ホーム画面に戻る
    switchPage('home');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.nav-btn[data-target="home"]').classList.add('active');
}

window.editRecord = function(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;

    editId = id;
    document.getElementById('recordId').value = record.id;
    document.getElementById('recordDate').value = record.date;
    
    if (record.type === 'expense') {
        document.getElementById('typeExpense').checked = true;
    } else {
        document.getElementById('typeIncome').checked = true;
    }
    updateCategorySelect();
    
    document.getElementById('recordAmount').value = record.amount;
    document.getElementById('recordCategory').value = record.category;
    document.getElementById('recordMemo').value = record.memo;

    document.getElementById('formTitle').textContent = '記録を編集';
    document.getElementById('cancelEditBtn').style.display = 'block';

    switchPage('add');
};

window.deleteRecord = function(id) {
    if (confirm('本当に削除しますか？')) {
        records = records.filter(r => r.id !== id);
        saveData();
        updateUI();
        showToast('削除しました');
    }
};

function resetForm() {
    editId = null;
    document.getElementById('recordForm').reset();
    document.getElementById('recordId').value = '';
    const today = new Date();
    document.getElementById('recordDate').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    document.getElementById('typeExpense').checked = true;
    updateCategorySelect();
    
    document.getElementById('formTitle').textContent = '記録を追加';
    document.getElementById('cancelEditBtn').style.display = 'none';
}

// 初期値として今日の日付をセット
resetForm();

// --- チャート描画処理 ---
function updateCharts() {
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim();
    const isDark = currentTheme === 'dark';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    Chart.defaults.color = textColor;
    Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font-family').trim();

    drawPieChart(textColor);
    drawBarChart(textColor, gridColor);
}

function drawPieChart(textColor) {
    const ctx = document.getElementById('pieChart').getContext('2d');
    
    // 今月の支出を用途別に集計
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    const categoryTotals = {};
    let totalExpense = 0;
    
    records.forEach(r => {
        if (r.type === 'expense' && r.date.startsWith(currentMonth)) {
            categoryTotals[r.category] = (categoryTotals[r.category] || 0) + Number(r.amount);
            totalExpense += Number(r.amount);
        }
    });

    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);
    
    // カラーパレット
    const colors = [
        '#ef4444', '#f97316', '#f59e0b', '#84cc16', 
        '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'
    ];

    if (pieChartInstance) {
        pieChartInstance.destroy();
    }

    if (totalExpense === 0) {
        // データがない場合
        pieChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['データなし'],
                datasets: [{ data: [1], backgroundColor: ['#64748b'] }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }

    pieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: textColor }
                }
            }
        }
    });
}

function drawBarChart(textColor, gridColor) {
    const ctx = document.getElementById('barChart').getContext('2d');
    
    // 過去12ヶ月のラベルとデータを準備
    const labels = [];
    const incomeData = [];
    const expenseData = [];
    
    const today = new Date();
    for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        labels.push(`${d.getMonth() + 1}月`);
        
        let inc = 0;
        let exp = 0;
        records.forEach(r => {
            if (r.date.startsWith(monthStr)) {
                if (r.type === 'income') inc += Number(r.amount);
                else exp += Number(r.amount);
            }
        });
        incomeData.push(inc);
        expenseData.push(exp);
    }

    if (barChartInstance) {
        barChartInstance.destroy();
    }

    barChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '収入',
                    data: incomeData,
                    backgroundColor: '#10b981',
                    borderRadius: 4
                },
                {
                    label: '支出',
                    data: expenseData,
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: textColor }
                }
            }
        }
    });
}

// --- エクスポート・インポート処理 ---
function exportData() {
    const dataStr = JSON.stringify(records, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = 'kakeibo_backup.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    showToast('エクスポートしました');
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm('現在のデータは上書きされます。インポートしますか？')) {
        e.target.value = ''; // cancel
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (Array.isArray(data)) {
                records = data;
                saveData();
                updateUI();
                showToast('インポートしました');
            } else {
                alert('無効なファイルフォーマットです。');
            }
        } catch (err) {
            alert('ファイルの読み込みに失敗しました。');
            console.error(err);
        }
    };
    reader.readAsText(file);
    
    // reset input
    e.target.value = '';
}

// --- トースト通知 ---
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// --- PWA サービスワーカー登録 ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registration successful');
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}
