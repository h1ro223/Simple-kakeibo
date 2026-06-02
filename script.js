import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase設定
const firebaseConfig = {
  apiKey: "AIzaSyBfj8aSj5Nq-phIIJzrPdLGyWGqAvEyxic",
  authDomain: "hiro-kaihatu.firebaseapp.com",
  projectId: "hiro-kaihatu",
  storageBucket: "hiro-kaihatu.firebasestorage.app",
  messagingSenderId: "414400851412",
  appId: "1:414400851412:web:b6e6c58adf3978298a7a41",
  measurementId: "G-7TGK9WQBCS"
};

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// オフラインキャッシュの有効化
enableIndexedDbPersistence(db).catch((err) => {
    console.log('Firebase persistence error:', err);
});

// --- 定数・状態管理 ---
const STORAGE_KEY = 'kakeibo_data';
const THEME_KEY = 'kakeibo_theme';

const CATEGORIES = {
    expense: ['食費', '日用品', '交通費', '娯楽', '医療費', '固定費', 'その他'],
    income: ['給料', '副収入', 'その他']
};

let records = [];
let editId = null;
let currentTheme = 'dark';
let pieChartInstance = null;
let barChartInstance = null;
let currentUser = null;
let unsubscribeSnapshot = null;

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupEventListeners();
    
    // Auth状態の監視
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        const accountBtnIcon = document.querySelector('#accountBtn i');
        const authForm = document.getElementById('authForm');
        const loggedInMenu = document.getElementById('loggedInMenu');
        const currentUserEmail = document.getElementById('currentUserEmail');
        const modalTitle = document.getElementById('modalTitle');
        const modalDesc = document.getElementById('modalDesc');

        if (user) {
            // ログイン済み
            accountBtnIcon.style.color = 'var(--income)';
            authForm.style.display = 'none';
            loggedInMenu.style.display = 'block';
            currentUserEmail.textContent = user.email;
            modalTitle.textContent = 'アカウント情報';
            modalDesc.textContent = '同期設定は有効です';
            
            migrateLocalDataToFirestore();
            loadDataFromFirestore();
        } else {
            // 未ログイン
            accountBtnIcon.style.color = '';
            authForm.style.display = 'block';
            loggedInMenu.style.display = 'none';
            modalTitle.textContent = 'アカウント';
            modalDesc.textContent = 'ログインしてデータを同期します';
            
            if (unsubscribeSnapshot) {
                unsubscribeSnapshot();
                unsubscribeSnapshot = null;
            }
            records = [];
            updateUI();
        }
    });
});

async function migrateLocalDataToFirestore() {
    if (!currentUser) return;
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
        try {
            const localRecords = JSON.parse(data);
            if (localRecords.length > 0) {
                showToast('ローカルデータを同期しています...');
                for (const r of localRecords) {
                    await setDoc(doc(db, 'users', currentUser.uid, 'records', r.id), r);
                }
                localStorage.removeItem(STORAGE_KEY);
                showToast('同期が完了しました');
            }
        } catch(e) {
            console.error('Migration error:', e);
        }
    }
}

function loadDataFromFirestore() {
    if (!currentUser) return;
    
    const recordsRef = collection(db, 'users', currentUser.uid, 'records');
    
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    
    unsubscribeSnapshot = onSnapshot(recordsRef, (snapshot) => {
        const newRecords = [];
        snapshot.forEach(doc => {
            newRecords.push(doc.data());
        });
        newRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
        records = newRecords;
        updateUI();
    }, (error) => {
        console.error('Firestore error:', error);
        showToast('データの取得に失敗しました');
    });
}

function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) {
        currentTheme = savedTheme;
    } else {
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
    if (pieChartInstance) updateCharts();
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, currentTheme);
    applyTheme();
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

    // ログインモーダル関連
    const loginModal = document.getElementById('loginModal');
    const authForm = document.getElementById('authForm');
    
    document.getElementById('accountBtn').addEventListener('click', () => {
        loginModal.classList.add('show');
    });
    document.getElementById('closeLoginModal').addEventListener('click', () => {
        loginModal.classList.remove('show');
    });
    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) loginModal.classList.remove('show');
    });

    // ログイン処理
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('authEmail').value;
        const password = document.getElementById('authPassword').value;
        try {
            await signInWithEmailAndPassword(auth, email, password);
            loginModal.classList.remove('show');
            showToast('ログインしました');
        } catch (error) {
            showToast('ログイン失敗: メールアドレスまたはパスワードが違います');
        }
    });

    // 新規登録処理
    document.getElementById('registerBtn').addEventListener('click', async () => {
        const email = document.getElementById('authEmail').value;
        const password = document.getElementById('authPassword').value;
        if (!email || !password) {
            showToast('メールアドレスとパスワードを入力してください');
            return;
        }
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            loginModal.classList.remove('show');
            showToast('アカウントを作成しログインしました');
        } catch (error) {
            showToast('登録失敗: ' + error.message);
        }
    });

    // ログアウト処理
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await signOut(auth);
            loginModal.classList.remove('show');
            showToast('ログアウトしました');
        } catch (error) {
            showToast('エラー: ' + error.message);
        }
    });

    updateCategorySelect();
    updateFilterCategorySelect();

    const today = new Date();
    document.getElementById('filterMonth').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(pageId).classList.add('active');

    if (pageId === 'home') renderHome();
    else if (pageId === 'history') renderHistory();
}

function updateUI() {
    renderHome();
    renderHistory();
}

// --- 画面描画処理 ---
function renderHome() {
    const today = new Date();
    const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    document.getElementById('currentMonthTitle').textContent = `${today.getFullYear()}年${today.getMonth() + 1}月`;

    let income = 0;
    let expense = 0;

    records.forEach(record => {
        if (record.date.startsWith(currentYearMonth)) {
            if (record.type === 'income') income += Number(record.amount);
            else expense += Number(record.amount);
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

function renderHistory() {
    const listEl = document.getElementById('historyList');
    listEl.innerHTML = '';

    const filterMonth = document.getElementById('filterMonth').value;
    const filterType = document.getElementById('filterType').value;
    const filterCategory = document.getElementById('filterCategory').value;

    let filteredRecords = records;

    if (filterMonth) filteredRecords = filteredRecords.filter(r => r.date.startsWith(filterMonth));
    if (filterType !== 'all') filteredRecords = filteredRecords.filter(r => r.type === filterType);
    if (filterCategory !== 'all') filteredRecords = filteredRecords.filter(r => r.category === filterCategory);

    if (filteredRecords.length === 0) {
        if (!currentUser) {
            listEl.innerHTML = `
                <div class="empty-state" onclick="document.getElementById('loginModal').classList.add('show')">
                    <i class="fa-solid fa-cloud"></i>
                    <p>ログインしてデータを同期しましょう</p>
                </div>
            `;
        } else {
            listEl.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-folder-open"></i>
                    <p>記録がありません</p>
                </div>
            `;
        }
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
async function handleFormSubmit(e) {
    e.preventDefault();
    if (!currentUser) {
        showToast('データの保存にはログインが必要です');
        document.getElementById('loginModal').classList.add('show');
        return;
    }

    const id = document.getElementById('recordId').value || crypto.randomUUID();
    const date = document.getElementById('recordDate').value;
    const type = document.querySelector('input[name="recordType"]:checked').value;
    const amount = document.getElementById('recordAmount').value;
    const category = document.getElementById('recordCategory').value;
    const memo = document.getElementById('recordMemo').value;

    const newRecord = { id, date, type, amount, category, memo };

    try {
        const docRef = doc(db, 'users', currentUser.uid, 'records', id);
        await setDoc(docRef, newRecord);
        showToast(editId ? '更新しました' : '登録しました');
        
        resetForm();
        switchPage('home');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.nav-btn[data-target="home"]').classList.add('active');
    } catch (error) {
        console.error("保存エラー", error);
        showToast('エラーが発生しました');
    }
}

window.editRecord = function(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;

    editId = id;
    document.getElementById('recordId').value = record.id;
    document.getElementById('recordDate').value = record.date;
    
    if (record.type === 'expense') document.getElementById('typeExpense').checked = true;
    else document.getElementById('typeIncome').checked = true;
    
    updateCategorySelect();
    
    document.getElementById('recordAmount').value = record.amount;
    document.getElementById('recordCategory').value = record.category;
    document.getElementById('recordMemo').value = record.memo;

    document.getElementById('formTitle').textContent = '記録を編集';
    document.getElementById('cancelEditBtn').style.display = 'block';

    switchPage('add');
};

window.deleteRecord = async function(id) {
    if (!currentUser) return;
    if (confirm('本当に削除しますか？')) {
        try {
            await deleteDoc(doc(db, 'users', currentUser.uid, 'records', id));
            showToast('削除しました');
        } catch (error) {
            console.error(error);
            showToast('エラーが発生しました');
        }
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
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

    if (pieChartInstance) pieChartInstance.destroy();

    if (totalExpense === 0) {
        pieChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: ['データなし'], datasets: [{ data: [1], backgroundColor: ['#64748b'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
        });
        return;
    }

    pieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: textColor } } } }
    });
}

function drawBarChart(textColor, gridColor) {
    const ctx = document.getElementById('barChart').getContext('2d');
    const labels = [];
    const incomeData = [];
    const expenseData = [];
    
    const today = new Date();
    for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        labels.push(`${d.getMonth() + 1}月`);
        
        let inc = 0, exp = 0;
        records.forEach(r => {
            if (r.date.startsWith(monthStr)) {
                if (r.type === 'income') inc += Number(r.amount);
                else exp += Number(r.amount);
            }
        });
        incomeData.push(inc);
        expenseData.push(exp);
    }

    if (barChartInstance) barChartInstance.destroy();

    barChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: '収入', data: incomeData, backgroundColor: '#10b981', borderRadius: 4 },
                { label: '支出', data: expenseData, backgroundColor: '#ef4444', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false }, ticks: { color: textColor } },
                y: { grid: { color: gridColor }, ticks: { color: textColor } }
            },
            plugins: { legend: { position: 'top', labels: { color: textColor } } }
        }
    });
}

// --- エクスポート・インポート処理 ---
function exportData() {
    if (records.length === 0) {
        showToast('エクスポートするデータがありません');
        return;
    }
    const dataStr = JSON.stringify(records, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', 'kakeibo_backup.json');
    linkElement.click();
    showToast('エクスポートしました');
}

async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!currentUser) {
        showToast('インポートするにはログインが必要です');
        e.target.value = '';
        return;
    }

    if (!confirm('現在のデータにインポートデータを追加します。よろしいですか？')) {
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (Array.isArray(data)) {
                showToast('インポート中...');
                for (const r of data) {
                    await setDoc(doc(db, 'users', currentUser.uid, 'records', r.id), r);
                }
                showToast('インポートが完了しました');
            } else {
                alert('無効なファイルフォーマットです。');
            }
        } catch (err) {
            alert('ファイルの読み込みに失敗しました。');
            console.error(err);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// --- PWA サービスワーカー登録 ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => { console.log('ServiceWorker registration successful'); })
            .catch(err => { console.log('ServiceWorker registration failed: ', err); });
    });
}
