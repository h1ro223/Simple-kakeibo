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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch((err) => {
    console.log('Firebase persistence error:', err);
});

// --- 定数・状態管理 ---
const STORAGE_KEY = 'kakeibo_data';
const THEME_KEY = 'kakeibo_theme';

const CATEGORIES = {
    expense: ['食費', '日用品', '交通費', '娯楽', 'ゲーム', '医療費', '固定費', 'その他'],
    income: ['給料', '副収入', 'その他']
};

let records = [];
let subscriptions = [];
let editId = null;
let currentTheme = 'dark';
let pieChartInstance = null;
let barChartInstance = null;
let currentUser = null;
let unsubscribeSnapshot = null;
let unsubscribeSubSnapshot = null;

let currentCalendarMonth = new Date();

// --- 仮想レコード生成 ---
function getAllRecords() {
    let virtualRecords = [];
    const currentYear = new Date().getFullYear();
    for (const sub of subscriptions) {
        for (let y = currentYear - 1; y <= currentYear + 1; y++) {
            for (let m = 0; m < 12; m++) {
                const lastDayOfMonth = new Date(y, m + 1, 0).getDate();
                const targetDay = Math.min(Number(sub.day), lastDayOfMonth);
                const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
                
                virtualRecords.push({
                    id: `sub_${sub.id}_${dStr}`,
                    date: dStr,
                    type: 'expense',
                    amount: sub.amount,
                    category: '固定費',
                    memo: sub.name,
                    isSubscription: true
                });
            }
        }
    }
    const combined = [...records, ...virtualRecords];
    combined.sort((a, b) => new Date(b.date) - new Date(a.date));
    return combined;
}

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupEventListeners();
    
    // サブスク日選択肢の生成
    const subDaySelect = document.getElementById('subDay');
    for (let i = 1; i <= 28; i++) {
        subDaySelect.innerHTML += `<option value="${i}">${i}日</option>`;
    }
    subDaySelect.innerHTML += `<option value="31">月末</option>`;

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        const accountBtnIcon = document.querySelector('#accountBtn i');
        const authForm = document.getElementById('authForm');
        const loggedInMenu = document.getElementById('loggedInMenu');
        const currentUserEmail = document.getElementById('currentUserEmail');
        const modalTitle = document.getElementById('modalTitle');
        const modalDesc = document.getElementById('modalDesc');

        if (user) {
            accountBtnIcon.style.color = 'var(--income)';
            authForm.style.display = 'none';
            loggedInMenu.style.display = 'block';
            
            const displayUser = user.email.split('@')[0];
            currentUserEmail.textContent = displayUser;
            
            modalTitle.textContent = 'アカウント情報';
            modalDesc.textContent = '同期設定は有効です';
            
            migrateLocalDataToFirestore();
            loadDataFromFirestore();
            loadSubscriptionsFromFirestore();
        } else {
            accountBtnIcon.style.color = '';
            authForm.style.display = 'block';
            loggedInMenu.style.display = 'none';
            modalTitle.textContent = 'アカウント';
            modalDesc.textContent = 'ログインしてデータを同期します';
            
            if (unsubscribeSnapshot) unsubscribeSnapshot();
            if (unsubscribeSubSnapshot) unsubscribeSubSnapshot();
            unsubscribeSnapshot = null;
            unsubscribeSubSnapshot = null;
            records = [];
            subscriptions = [];
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
        } catch(e) { console.error(e); }
    }
}

function loadDataFromFirestore() {
    if (!currentUser) return;
    const recordsRef = collection(db, 'users', currentUser.uid, 'records');
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    
    unsubscribeSnapshot = onSnapshot(recordsRef, (snapshot) => {
        const newRecords = [];
        snapshot.forEach(doc => newRecords.push(doc.data()));
        records = newRecords;
        updateUI();
    }, (error) => {
        console.error(error);
        showToast('データの取得に失敗しました');
    });
}

function loadSubscriptionsFromFirestore() {
    if (!currentUser) return;
    const subRef = collection(db, 'users', currentUser.uid, 'subscriptions');
    if (unsubscribeSubSnapshot) unsubscribeSubSnapshot();
    
    unsubscribeSubSnapshot = onSnapshot(subRef, (snapshot) => {
        const newSubs = [];
        snapshot.forEach(doc => newSubs.push(doc.data()));
        subscriptions = newSubs;
        updateUI();
        renderSubList();
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
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

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

    document.getElementById('recordForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('typeExpense').addEventListener('change', updateCategorySelect);
    document.getElementById('typeIncome').addEventListener('change', updateCategorySelect);
    document.getElementById('cancelEditBtn').addEventListener('click', resetForm);

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

    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', importData);

    const loginModal = document.getElementById('loginModal');
    const authForm = document.getElementById('authForm');
    
    document.getElementById('accountBtn').addEventListener('click', () => loginModal.classList.add('show'));
    document.getElementById('closeLoginModal').addEventListener('click', () => loginModal.classList.remove('show'));
    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) loginModal.classList.remove('show');
    });

    const getDummyEmail = (username) => `${username}@kakeibo.local`;

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('authUsername').value;
        const password = document.getElementById('authPassword').value;
        if (!/^[a-zA-Z0-9]{1,8}$/.test(username)) {
            showToast('ユーザー名は半角英数字8文字以内で入力してください');
            return;
        }
        try {
            await signInWithEmailAndPassword(auth, getDummyEmail(username), password);
            loginModal.classList.remove('show');
            showToast('ログインしました');
        } catch (error) {
            showToast('ログイン失敗: ユーザー名またはパスワードが違います');
        }
    });

    document.getElementById('registerBtn').addEventListener('click', async () => {
        const username = document.getElementById('authUsername').value;
        const password = document.getElementById('authPassword').value;
        if (!username || !password) {
            showToast('ユーザー名とパスワードを入力してください');
            return;
        }
        if (!/^[a-zA-Z0-9]{1,8}$/.test(username)) {
            showToast('ユーザー名は半角英数字8文字以内で入力してください');
            return;
        }
        try {
            await createUserWithEmailAndPassword(auth, getDummyEmail(username), password);
            loginModal.classList.remove('show');
            showToast('アカウントを作成しログインしました');
        } catch (error) {
            showToast('登録失敗: ' + error.message);
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await signOut(auth);
            loginModal.classList.remove('show');
            showToast('ログアウトしました');
        } catch (error) { showToast('エラー: ' + error.message); }
    });

    // カレンダー関連
    document.getElementById('prevMonthBtn').addEventListener('click', () => {
        currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('nextMonthBtn').addEventListener('click', () => {
        currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + 1);
        renderCalendar();
    });

    // サブスク関連
    const subModal = document.getElementById('subModal');
    document.getElementById('openSubModalBtn').addEventListener('click', () => subModal.classList.add('show'));
    document.getElementById('closeSubModal').addEventListener('click', () => subModal.classList.remove('show'));
    subModal.addEventListener('click', (e) => {
        if (e.target === subModal) subModal.classList.remove('show');
    });
    document.getElementById('subForm').addEventListener('submit', handleSubSubmit);

    updateCategorySelect();
    updateFilterCategorySelect();

    const today = new Date();
    document.getElementById('filterMonth').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');

    if (pageId === 'home') renderHome();
    else if (pageId === 'history') renderHistory();
    else if (pageId === 'calendar') renderCalendar();
}

function updateUI() {
    renderHome();
    renderHistory();
    renderCalendar();
}

// --- 画面描画処理 ---
function renderHome() {
    const today = new Date();
    const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    document.getElementById('currentMonthTitle').textContent = `${today.getFullYear()}年${today.getMonth() + 1}月`;

    let income = 0;
    let expense = 0;
    
    const allRecs = getAllRecords();

    allRecs.forEach(record => {
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

    updateCharts(allRecs);
}

function renderHistory() {
    const listEl = document.getElementById('historyList');
    listEl.innerHTML = '';

    const filterMonth = document.getElementById('filterMonth').value;
    const filterType = document.getElementById('filterType').value;
    const filterCategory = document.getElementById('filterCategory').value;

    let filteredRecords = getAllRecords();

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
        
        const subIcon = record.isSubscription ? ' <i class="fa-solid fa-rotate" title="自動サブスク" style="color:var(--primary); margin-left:4px; font-size:0.8rem;"></i>' : '';

        item.innerHTML = `
            <div class="history-info">
                <div class="history-cat">${record.category}${subIcon}</div>
                <div class="history-meta">
                    <span><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
                    ${record.memo ? `<span><i class="fa-regular fa-comment"></i> ${record.memo}</span>` : ''}
                </div>
            </div>
            <div class="history-amount">${sign}${Number(record.amount).toLocaleString()}円</div>
            <div class="history-actions">
                ${record.isSubscription ? '' : `
                    <button class="action-btn" onclick="editRecord('${record.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="action-btn delete" onclick="deleteRecord('${record.id}')"><i class="fa-solid fa-trash"></i></button>
                `}
            </div>
        `;
        listEl.appendChild(item);
    });
}

function renderCalendar() {
    const y = currentCalendarMonth.getFullYear();
    const m = currentCalendarMonth.getMonth();
    document.getElementById('calendarMonthTitle').textContent = `${y}年${m + 1}月`;
    
    const grid = document.querySelector('.calendar-grid');
    Array.from(grid.children).forEach(child => {
        if (!child.classList.contains('weekday')) grid.removeChild(child);
    });

    const firstDay = new Date(y, m, 1).getDay();
    const lastDate = new Date(y, m + 1, 0).getDate();
    
    const allRecs = getAllRecords();
    const monthStr = `${y}-${String(m + 1).padStart(2, '0')}`;
    
    const dailyData = {};
    allRecs.forEach(r => {
        if (r.date.startsWith(monthStr)) {
            const d = parseInt(r.date.split('-')[2], 10);
            if (!dailyData[d]) dailyData[d] = { income: 0, expense: 0, records: [] };
            if (r.type === 'income') dailyData[d].income += Number(r.amount);
            else dailyData[d].expense += Number(r.amount);
            dailyData[d].records.push(r);
        }
    });

    for (let i = 0; i < firstDay; i++) {
        const div = document.createElement('div');
        div.className = 'calendar-day empty';
        grid.appendChild(div);
    }
    
    for (let d = 1; d <= lastDate; d++) {
        const div = document.createElement('div');
        div.className = 'calendar-day';
        
        let html = `<div class="day-num">${d}</div>`;
        if (dailyData[d]) {
            if (dailyData[d].income > 0) html += `<div class="day-income">+${dailyData[d].income.toLocaleString()}</div>`;
            if (dailyData[d].expense > 0) html += `<div class="day-expense">-${dailyData[d].expense.toLocaleString()}</div>`;
        }
        div.innerHTML = html;
        
        div.addEventListener('click', () => {
            document.querySelectorAll('.calendar-day').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            showCalendarDetails(y, m + 1, d, dailyData[d] ? dailyData[d].records : []);
        });
        
        grid.appendChild(div);
    }
    
    document.getElementById('calendarDayDetails').style.display = 'none';
}

function showCalendarDetails(y, m, d, dayRecords) {
    const detailsDiv = document.getElementById('calendarDayDetails');
    const title = document.getElementById('calendarSelectedDate');
    const recordsDiv = document.getElementById('calendarDayRecords');
    
    detailsDiv.style.display = 'block';
    title.textContent = `${y}年${m}月${d}日 の記録`;
    recordsDiv.innerHTML = '';
    
    if (dayRecords.length === 0) {
        recordsDiv.innerHTML = '<p style="color: var(--text-muted); text-align: center; margin-top: 10px;">記録はありません</p>';
        return;
    }
    
    dayRecords.forEach(r => {
        const isExp = r.type === 'expense';
        const sign = isExp ? '-' : '+';
        const subIcon = r.isSubscription ? ' <i class="fa-solid fa-rotate" title="自動サブスク" style="color:var(--primary); margin-left:4px;"></i>' : '';
        
        const item = document.createElement('div');
        item.className = `history-item is-${r.type}`;
        item.style.marginBottom = '8px';
        item.innerHTML = `
            <div class="history-info">
                <div class="history-cat">${r.category}${subIcon}</div>
                <div class="history-meta">
                    ${r.memo ? `<span><i class="fa-regular fa-comment"></i> ${r.memo}</span>` : ''}
                </div>
            </div>
            <div class="history-amount">${sign}${Number(r.amount).toLocaleString()}円</div>
        `;
        recordsDiv.appendChild(item);
    });
}

// --- サブスク管理処理 ---
async function handleSubSubmit(e) {
    e.preventDefault();
    if (!currentUser) {
        showToast('サブスク管理にはログインが必要です');
        return;
    }
    
    const id = crypto.randomUUID();
    const name = document.getElementById('subName').value;
    const amount = document.getElementById('subAmount').value;
    const day = document.getElementById('subDay').value;
    
    const newSub = { id, name, amount, day };
    
    try {
        await setDoc(doc(db, 'users', currentUser.uid, 'subscriptions', id), newSub);
        showToast('サブスクリプションを追加しました');
        document.getElementById('subForm').reset();
    } catch (error) {
        showToast('追加に失敗しました');
    }
}

window.deleteSub = async function(id) {
    if (!currentUser) return;
    if (confirm('このサブスクリプションを削除しますか？\n(過去の自動入力データもグラフ・履歴から除外されます)')) {
        try {
            await deleteDoc(doc(db, 'users', currentUser.uid, 'subscriptions', id));
            showToast('サブスクリプションを削除しました');
        } catch (error) {
            showToast('エラーが発生しました');
        }
    }
};

function renderSubList() {
    const listEl = document.getElementById('subList');
    listEl.innerHTML = '';
    
    if (subscriptions.length === 0) {
        listEl.innerHTML = '<p style="color: var(--text-muted); text-align: center; margin-top: 10px;">登録されていません</p>';
        return;
    }
    
    subscriptions.forEach(sub => {
        const item = document.createElement('div');
        item.className = 'history-item is-expense';
        item.innerHTML = `
            <div class="history-info">
                <div class="history-cat"><i class="fa-solid fa-rotate"></i> ${sub.name}</div>
                <div class="history-meta">
                    <span>毎月 ${sub.day == 31 ? '末' : sub.day} 日引き落とし</span>
                </div>
            </div>
            <div class="history-amount">-${Number(sub.amount).toLocaleString()}円</div>
            <div class="history-actions">
                <button class="action-btn delete" onclick="deleteSub('${sub.id}')"><i class="fa-solid fa-trash"></i></button>
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

    const newRecord = { id, date, type, amount, category, memo, isSubscription: false };

    try {
        const docRef = doc(db, 'users', currentUser.uid, 'records', id);
        await setDoc(docRef, newRecord);
        showToast(editId ? '更新しました' : '登録しました');
        
        resetForm();
        switchPage('home');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.nav-btn[data-target="home"]').classList.add('active');
    } catch (error) {
        showToast('エラーが発生しました');
    }
}

window.editRecord = function(id) {
    const record = records.find(r => r.id === id);
    if (!record || record.isSubscription) return; // サブスクは編集不可

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
    const record = records.find(r => r.id === id);
    if (record && record.isSubscription) return; // サブスクは履歴から削除不可

    if (confirm('本当に削除しますか？')) {
        try {
            await deleteDoc(doc(db, 'users', currentUser.uid, 'records', id));
            showToast('削除しました');
        } catch (error) {
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
function updateCharts(allRecs = getAllRecords()) {
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim();
    const isDark = currentTheme === 'dark';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    Chart.defaults.color = textColor;
    Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font-family').trim();

    drawPieChart(textColor, allRecs);
    drawBarChart(textColor, gridColor, allRecs);
}

function drawPieChart(textColor, allRecs) {
    const ctx = document.getElementById('pieChart').getContext('2d');
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    const categoryTotals = {};
    let totalExpense = 0;
    
    allRecs.forEach(r => {
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
            options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
        });
        return;
    }

    pieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }] },
        options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: textColor } } } }
    });
}

function drawBarChart(textColor, gridColor, allRecs) {
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
        allRecs.forEach(r => {
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
            animation: false,
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
        showToast('エクスポートする実データがありません');
        return;
    }
    // 仮想データは除外して出力
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
                    if (r.isSubscription) continue; // 過去の仮想データが入っていた場合は無視
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

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .catch(err => { console.log('ServiceWorker registration failed: ', err); });
    });
}
