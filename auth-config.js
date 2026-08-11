// ==========================================
// FIREBASE AUTHENTICATION & CLOUD SYNC
// ==========================================

// Firebase Variables
let currentUser = null;
let unsubscribeSnapshot = null;
let syncTimeout = null;
let isCloudSynced = false;
let lastSyncedVersion = 0;

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDVr6AE4xxwW9l1mmhDLyaE2yq3JW6CoNg",
    authDomain: "expensy-note.firebaseapp.com",
    projectId: "expensy-note",
    storageBucket: "expensy-note.firebasestorage.app",
    messagingSenderId: "1007369333200",
    appId: "1:1007369333200:web:e755f04949508cf93a71d5",
    measurementId: "G-9MBMJZ2SWE"
};

// Initialize Firebase
if (firebaseConfig.apiKey) {
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();
    
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => {
        console.warn("Auth persistence error:", err.message);
    });
    
    db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        console.warn("Firebase persistence error:", err.code);
    });
    
    const signinBtn = document.getElementById('google-signin-btn');
    const syncStatusBtn = document.getElementById('cloud-sync-btn');

    signinBtn.addEventListener('click', () => {
        if (currentUser) {
            auth.signOut().then(() => {
                totalExpenses = 0;
                expensesArray = [];
                budgetsArray = [{ id: Date.now(), amount: 0, val: '', timestamp: '', entryTime: 0, history: [] }];
                localDataVersion = 0; 
                lastSyncedVersion = 0; 
                
                deletedSyncIds = []; 
                globalResetTime = 0; 
                currentEditingId = null;
                
                document.getElementById('expense-name').value = '';
                document.getElementById('expense-amount').value = '';
                document.getElementById('entry-custom-date').value = '';
                if(typeof markCustomDate === 'function') markCustomDate(true);
                document.getElementById('month-filter').value = 'all'; 
                
                renderBudgets();
                updateMonthFilterOptions(); 
                renderAllExpenses();
                updateAppCalculations();
                
                localStorage.removeItem(STORAGE_KEY);
                
                alert("Sign out successful.");
            });
        } else {
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            
            auth.signInWithPopup(provider).catch(error => {
                if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
                    auth.signInWithRedirect(provider);
                } else {
                    alert("Sign In Failed: " + error.message);
                }
            });
        }
    });

    auth.onAuthStateChanged(user => {
        if (user) {
            // user.js ফাইল থেকে ALLOWED_EMAILS লিস্ট চেক করা হচ্ছে
            if (!ALLOWED_EMAILS.includes(user.email)) {
                alert("Access Denied! Unauthorized Email ID.");
                auth.signOut();
                return;
            }

            currentUser = user;
            isCloudSynced = false; 
            signinBtn.textContent = "Sign out";
            signinBtn.style.color = "#ff6b6b";
            
            syncStatusBtn.textContent = "SYNCED";
            syncStatusBtn.style.color = "#8DFF4A";
            syncStatusBtn.style.borderColor = "rgba(141, 255, 74, 0.4)";
            
            loadFromCloud();
        } else {
            currentUser = null;
            signinBtn.textContent = "Sign in";
            signinBtn.style.color = "#34c759";
            
            syncStatusBtn.textContent = "Offline";
            syncStatusBtn.style.color = "#8e8e93";
            syncStatusBtn.style.borderColor = "rgba(255, 255, 255, 0.1)";
            
            if(unsubscribeSnapshot) {
                unsubscribeSnapshot();
                unsubscribeSnapshot = null;
            }
        }
    });

    window.syncToCloud = function(immediate = false) {
        if (!currentUser) return;
        
        if (!isCloudSynced && !window.isResetting) {
            return; 
        }

        if (localDataVersion <= lastSyncedVersion && !window.isResetting) {
            return;
        }
        
        const pushData = () => {
            const dataToSave = {
                budgetsArray,
                expensesArray,
                localDataVersion, 
                deletedSyncIds, 
                globalResetTime, 
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            db.collection('userData').doc(currentUser.uid).set(dataToSave, {merge: true})
              .then(() => {
                  window.isResetting = false; 
                  lastSyncedVersion = localDataVersion; 
              })
              .catch(e => {
                  console.log("Cloud sync error", e);
                  window.isResetting = false; 
              });
        };

        clearTimeout(syncTimeout);
        
        if (immediate) {
            pushData();
        } else {
            syncTimeout = setTimeout(pushData, 1000); 
        }
    };

    function loadFromCloud() {
        if (!currentUser) return;
        
        unsubscribeSnapshot = db.collection('userData').doc(currentUser.uid).onSnapshot({ includeMetadataChanges: true }, doc => {
            if (window.isResetting) return; 

            if (doc.exists) {
                isCloudSynced = true; 
                const data = doc.data();
                
                lastSyncedVersion = data.localDataVersion || 0; 
                const cloudResetTime = data.globalResetTime || 0;
                const cloudDeletedIds = data.deletedSyncIds || [];

                if (cloudResetTime > globalResetTime) {
                    expensesArray = [];
                    budgetsArray = [{ id: Date.now(), amount: 0, val: '', timestamp: '', entryTime: 0, history: [] }];
                    deletedSyncIds = [];
                    globalResetTime = cloudResetTime;
                    localDataVersion = data.localDataVersion || 0;
                    
                    renderBudgets();
                    updateMonthFilterOptions();
                    renderAllExpenses();
                    updateAppCalculations();
                    autoSaveToLocalStorage();
                    return;
                }

                deletedSyncIds = [...new Set([...deletedSyncIds, ...cloudDeletedIds])];

                const activeEl = document.activeElement;
                let activeBudgetId = null;
                if (activeEl && activeEl.classList.contains('input-budget-dynamic')) {
                    activeBudgetId = activeEl.id.replace('input-budget-', '');
                }

                const cloudExpenses = Array.isArray(data.expensesArray) ? data.expensesArray : [];
                const mergedExpensesMap = new Map();

                expensesArray.forEach(item => {
                    if (!deletedSyncIds.includes(String(item.id))) mergedExpensesMap.set(String(item.id), item);
                });

                cloudExpenses.forEach(item => {
                    if (!deletedSyncIds.includes(String(item.id))) {
                        if (currentEditingId === String(item.id)) return;
                        mergedExpensesMap.set(String(item.id), item);
                    }
                });

                const newExpensesArray = Array.from(mergedExpensesMap.values()).sort((a, b) => a.entryTime - b.entryTime);

                const cloudBudgets = Array.isArray(data.budgetsArray) ? data.budgetsArray : [];

                if (cloudBudgets.length > 0 && budgetsArray.length === 1) {
                    const fb = budgetsArray[0];
                    const isFbEmpty = fb.amount === 0 && (!fb.val || fb.val.trim() === '') && (!fb.history || fb.history.length === 0);
                    if (isFbEmpty && String(fb.id) !== activeBudgetId) {
                        budgetsArray = [];
                    }
                }

                const mergedBudgetsMap = new Map();

                budgetsArray.forEach(b => {
                    if (!deletedSyncIds.includes(String(b.id))) {
                        mergedBudgetsMap.set(String(b.id), b);
                    }
                });

                cloudBudgets.forEach(b => {
                    if (!deletedSyncIds.includes(String(b.id))) {
                        if (activeBudgetId === String(b.id)) return; 
                        mergedBudgetsMap.set(String(b.id), b);
                    }
                });

                let rawMergedBudgets = Array.from(mergedBudgetsMap.values());
                
                const isEmptyBox = (b) => (b.amount === 0 && (!b.val || b.val.trim() === '') && (!b.history || b.history.length === 0));
                
                let realBudgets = [];
                let blankBudgets = [];

                rawMergedBudgets.forEach(b => {
                    if (isEmptyBox(b)) blankBudgets.push(b);
                    else realBudgets.push(b);
                });

                let finalBudgets = [...realBudgets];

                if (blankBudgets.length > 0) {
                    let keptBlank = blankBudgets.find(b => String(b.id) === activeBudgetId);
                    
                    if (!keptBlank) {
                        keptBlank = blankBudgets.find(b => (Date.now() - (b.entryTime || 0)) < 5000);
                    }

                    if (keptBlank) {
                        finalBudgets.push(keptBlank);
                    } else if (realBudgets.length === 0) {
                        blankBudgets.sort((a, b) => (b.entryTime || 0) - (a.entryTime || 0));
                        finalBudgets.push(blankBudgets[0]);
                    }
                }

                if (finalBudgets.length === 0) {
                    if (budgetsArray.length > 0) {
                        finalBudgets.push(budgetsArray[0]); 
                    } else {
                        finalBudgets.push({ id: Date.now(), amount: 0, val: '', timestamp: '', entryTime: Date.now(), history: [] });
                    }
                }

                let newBudgetsArray = finalBudgets.sort((a, b) => a.entryTime - b.entryTime);

                const dataChanged = (JSON.stringify(expensesArray) !== JSON.stringify(newExpensesArray)) || 
                                    (JSON.stringify(budgetsArray) !== JSON.stringify(newBudgetsArray));

                expensesArray = newExpensesArray;
                budgetsArray = newBudgetsArray;
                
                localDataVersion = Math.max(localDataVersion, data.localDataVersion || 0);

                if (dataChanged) {
                    const activeElCheck = document.activeElement;
                    const isBudgetTyping = activeElCheck && activeElCheck.classList.contains('input-budget-dynamic');
                    const isDatePickerActive = activeElCheck && activeElCheck.classList.contains('hidden-date-input');
                    
                    if (!isBudgetTyping) {
                        renderBudgets();
                    }
                    
                    updateMonthFilterOptions();
                    
                    if (!isDatePickerActive) {
                        renderAllExpenses();
                    }
                    
                    updateAppCalculations();
                }

                autoSaveToLocalStorage();

                if (localDataVersion > lastSyncedVersion || expensesArray.length > cloudExpenses.length || budgetsArray.length > cloudBudgets.length || deletedSyncIds.length > cloudDeletedIds.length) {
                    window.syncToCloud(true);
                }

            } else {
                if (!doc.metadata.fromCache) {
                    isCloudSynced = true;
                    window.syncToCloud(true);
                }
            }
        });
    }

    // Network Listeners for Firestore
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine && currentUser) {
            db.enableNetwork().catch(console.error);
        }
    });

    window.addEventListener('online', () => {
        if (currentUser) db.enableNetwork().catch(console.error);
    });

    window.addEventListener('offline', () => {
        if (currentUser) db.disableNetwork().catch(console.error);
    });
}