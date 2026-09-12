import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Transaction = {
    id: string;
    amount: number;
    type: 'minus' | 'plus' | 'transfer';
    category: string;
    fromWallet?: string;
    toWallet?: string;
    date: string;
};

type FixedExpense = {
    id: string;
    name: string;
    amount: number;
};

type Wallet = {
    id: string;
    name: string;
    balance: number;
};

export default function HistoryScreen() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([]);
    const [wallets, setWallets] = useState<string[]>(['現金', '銀行口座', 'PayPay', 'Suica', 'クレジットカード']);

    // 締め日（給与日）設定
    const [payday, setPayday] = useState<number>(25);
    const [isEditingPayday, setIsEditingPayday] = useState(false);
    const [paydayInput, setPaydayInput] = useState('25');

    // 表示基準月（Offset: 0=今月期, -1=前月期, +1=来月期）
    const [monthOffset, setMonthOffset] = useState(0);

    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    const [fixedName, setFixedName] = useState('');
    const [fixedAmount, setFixedAmount] = useState('');

    // 編集モーダル用の状態
    const [editingTx, setEditingTx] = useState<Transaction | null>(null);
    const [editAmount, setEditAmount] = useState('');
    const [editType, setEditType] = useState<'minus' | 'plus' | 'transfer'>('minus');
    const [editCategory, setEditCategory] = useState('');
    const [editFromWallet, setEditFromWallet] = useState('');
    const [editToWallet, setEditToWallet] = useState('');
    const [editWallet, setEditWallet] = useState('');
    const [editDate, setEditDate] = useState('');

    useFocusEffect(
        useCallback(() => {
            loadData();
            const interval = setInterval(() => {
                loadData();
            }, 1000);
            return () => clearInterval(interval);
        }, [])
    );

    const loadData = async () => {
        try {
            const storedPayday = await AsyncStorage.getItem('@payday_setting');
            if (storedPayday) {
                setPayday(Number(storedPayday));
                setPaydayInput(storedPayday);
            }

            const storedTx = await AsyncStorage.getItem('@transactions');
            if (storedTx) setTransactions(JSON.parse(storedTx));

            const storedFixed = await AsyncStorage.getItem('@fixed_expenses');
            if (storedFixed) setFixedExpenses(JSON.parse(storedFixed));

            const storedWallets = await AsyncStorage.getItem('@custom_wallets');
            if (storedWallets) {
                const parsed: Wallet[] = JSON.parse(storedWallets);
                setWallets(parsed.map((w) => w.name));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleSavePayday = async () => {
        const day = Number(paydayInput);
        if (isNaN(day) || day < 1 || day > 31) return;
        setPayday(day);
        await AsyncStorage.setItem('@payday_setting', String(day));
        setIsEditingPayday(false);
    };

    // 編集モーダルを開く
    const openEditModal = (item: Transaction) => {
        setEditingTx(item);
        setEditAmount(String(item.amount));
        setEditType(item.type);
        setEditCategory(item.category);
        setEditFromWallet(item.fromWallet || '現金');
        setEditToWallet(item.toWallet || 'Suica');
        setEditWallet(item.type === 'plus' ? item.toWallet || '現金' : item.fromWallet || '現金');

        const d = new Date(item.date);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate()
        ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        setEditDate(dateStr);
    };

    // 編集内容の保存
    const handleSaveEdit = async () => {
        if (!editingTx) return;

        const amountNum = Number(editAmount);
        if (isNaN(amountNum) || amountNum <= 0) {
            Alert.alert('エラー', '正しい金額を入力してください。');
            return;
        }

        let parsedDate = new Date(editDate).toISOString();
        if (isNaN(new Date(parsedDate).getTime())) {
            parsedDate = editingTx.date;
        }

        const updatedTx: Transaction = {
            ...editingTx,
            amount: amountNum,
            type: editType,
            category: editType === 'transfer' ? 'チャージ/移動' : editCategory,
            fromWallet: editType === 'plus' ? undefined : editType === 'transfer' ? editFromWallet : editWallet,
            toWallet: editType === 'minus' ? undefined : editType === 'transfer' ? editToWallet : editWallet,
            date: parsedDate,
        };

        const newTxList = transactions.map((t) => (t.id === editingTx.id ? updatedTx : t));
        newTxList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        try {
            await AsyncStorage.setItem('@transactions', JSON.stringify(newTxList));
            setTransactions(newTxList);
            setEditingTx(null);
        } catch (e) {
            Alert.alert('エラー', '保存に失敗しました。');
        }
    };

    // 締め日に基づく期間（開始日〜終了日）を判定する関数
    const getPeriodRange = (offset: number, day: number) => {
        const now = new Date();
        let year = now.getFullYear();
        let month = now.getMonth() + offset;

        const startDate = new Date(year, month, day, 0, 0, 0);
        const endDate = new Date(year, month + 1, day - 1, 23, 59, 59);

        return { startDate, endDate };
    };

    const currentPeriod = getPeriodRange(monthOffset, payday);
    const prevPeriod = getPeriodRange(monthOffset - 1, payday);

    // 指定期間に含まれる取引かチェック
    const isTxInPeriod = (txDateStr: string, start: Date, end: Date) => {
        const d = new Date(txDateStr);
        return d >= start && d <= end;
    };

    // 当期の取引
    const monthTransactions = transactions.filter((t) =>
        isTxInPeriod(t.date, currentPeriod.startDate, currentPeriod.endDate)
    );

    // 当期の通常取引（チャージ・クレカ決済を除く）
    const currentNormalTx = monthTransactions.filter(
        (item) => item.type !== 'transfer' && item.category !== 'クレカ決済'
    );

    const totalIncome = currentNormalTx
        .filter((item) => item.type === 'plus')
        .reduce((sum, item) => sum + item.amount, 0);

    const totalExpenseNormal = currentNormalTx
        .filter((item) => item.type === 'minus')
        .reduce((sum, item) => sum + item.amount, 0);

    // 前期に発生した「クレカ決済」（当期引き落とし）
    const prevCreditTx = transactions.filter(
        (item) =>
            isTxInPeriod(item.date, prevPeriod.startDate, prevPeriod.endDate) &&
            item.category === 'クレカ決済' &&
            item.type === 'minus'
    );

    const creditDeduction = prevCreditTx.reduce((sum, item) => sum + item.amount, 0);
    const totalFixed = fixedExpenses.reduce((sum, item) => sum + item.amount, 0);

    const totalExpenseEffective = totalExpenseNormal + creditDeduction;
    const monthlyBalance = totalIncome - (totalExpenseEffective + totalFixed);

    // カテゴリ集計
    const categoryTotals = monthTransactions
        .filter((t) => t.type !== 'transfer')
        .reduce((acc, item) => {
            if (!acc[item.category]) {
                acc[item.category] = { amount: 0, type: item.type };
            }
            acc[item.category].amount += item.amount;
            return acc;
        }, {} as Record<string, { amount: number; type: 'minus' | 'plus' | 'transfer' }>);

    const categoryList = Object.keys(categoryTotals)
        .map((cat) => ({
            category: cat,
            amount: categoryTotals[cat].amount,
            type: categoryTotals[cat].type,
        }))
        .sort((a, b) => b.amount - a.amount);

    const filteredTransactions = selectedCategory
        ? monthTransactions.filter((item) => item.category === selectedCategory)
        : monthTransactions;

    const handleAddFixed = async () => {
        const numAmount = Number(fixedAmount);
        if (!fixedName.trim() || numAmount <= 0) return;

        const newFixed: FixedExpense = { id: Date.now().toString(), name: fixedName.trim(), amount: numAmount };
        const updated = [...fixedExpenses, newFixed];
        setFixedExpenses(updated);
        await AsyncStorage.setItem('@fixed_expenses', JSON.stringify(updated));

        setFixedName('');
        setFixedAmount('');
    };

    const handleDeleteFixed = async (id: string) => {
        const updated = fixedExpenses.filter((item) => item.id !== id);
        setFixedExpenses(updated);
        await AsyncStorage.setItem('@fixed_expenses', JSON.stringify(updated));
    };

    const handleDeleteTx = async (id: string) => {
        const updated = transactions.filter((item) => item.id !== id);
        setTransactions(updated);
        await AsyncStorage.setItem('@transactions', JSON.stringify(updated));
    };

    const formatDateShort = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
            <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
                {/* 1. 給与日（締め日）設定バー */}
                <View style={styles.paydayBar}>
                    <Text style={styles.paydayText}>
                        📅 家計簿締め日: <Text style={{ fontWeight: 'bold', color: '#3b5bdb' }}>毎月 {payday} 日</Text> スタート
                    </Text>
                    <TouchableOpacity onPress={() => setIsEditingPayday(!isEditingPayday)} style={styles.paydayEditButton}>
                        <Text style={styles.paydayEditText}>{isEditingPayday ? '閉じる' : '変更'}</Text>
                    </TouchableOpacity>
                </View>

                {isEditingPayday && (
                    <View style={styles.paydayForm}>
                        <Text style={styles.paydayFormLabel}>給料日・開始日（1〜31日）:</Text>
                        <TextInput
                            style={styles.paydayInput}
                            keyboardType="numeric"
                            value={paydayInput}
                            onChangeText={setPaydayInput}
                        />
                        <TouchableOpacity style={styles.paydaySaveButton} onPress={handleSavePayday}>
                            <Text style={styles.paydaySaveText}>保存</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* 2. 期間選択ヘッダー */}
                <View style={styles.monthSelector}>
                    <TouchableOpacity onPress={() => setMonthOffset(monthOffset - 1)} style={styles.monthArrowButton}>
                        <Text style={styles.monthArrowText}>◀ 前期</Text>
                    </TouchableOpacity>
                    <View style={{ alignItems: 'center' }}>
                        <Text style={styles.monthTitle}>
                            {formatDateShort(currentPeriod.startDate)} 〜 {formatDateShort(currentPeriod.endDate)}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#868e96' }}>
                            {monthOffset === 0 ? '（現在の集計期間）' : monthOffset > 0 ? `（${monthOffset}ヶ月後）` : `（${Math.abs(monthOffset)}ヶ月前）`}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={() => setMonthOffset(monthOffset + 1)} style={styles.monthArrowButton}>
                        <Text style={styles.monthArrowText}>次期 ▶</Text>
                    </TouchableOpacity>
                </View>

                {/* 3. 期間内収支サマリー */}
                <View style={styles.summaryCard}>
                    <Text style={styles.summaryTitle}>期間内収支まとめ</Text>
                    <View style={styles.summaryGrid}>
                        <View style={styles.summaryItem}>
                            <Text style={styles.summaryLabel}>収入</Text>
                            <Text style={[styles.summaryValue, styles.plusText]}>＋{totalIncome.toLocaleString()}円</Text>
                        </View>
                        <View style={styles.summaryItem}>
                            <Text style={styles.summaryLabel}>変動支出</Text>
                            <Text style={[styles.summaryValue, styles.minusText]}>−{totalExpenseNormal.toLocaleString()}円</Text>
                        </View>

                        <View style={styles.summaryItem}>
                            <Text style={styles.summaryLabel}>前期クレカ引落</Text>
                            <Text style={[styles.summaryValue, { color: '#e8590c' }]}>−{creditDeduction.toLocaleString()}円</Text>
                        </View>

                        <View style={styles.summaryItem}>
                            <Text style={styles.summaryLabel}>固定費</Text>
                            <Text style={[styles.summaryValue, styles.minusText]}>−{totalFixed.toLocaleString()}円</Text>
                        </View>
                    </View>

                    <View style={styles.summaryDivider} />

                    <View style={styles.balanceRow}>
                        <Text style={styles.balanceLabel}>この期間の収支残高</Text>
                        <Text style={[styles.balanceValue, monthlyBalance >= 0 ? styles.plusText : styles.minusText]}>
                            {monthlyBalance >= 0 ? '＋' : ''}{monthlyBalance.toLocaleString()} 円
                        </Text>
                    </View>
                </View>

                {/* 4. カテゴリ別利用額 */}
                <View style={styles.section}>
                    <View style={styles.sectionHeaderRow}>
                        <Text style={styles.sectionTitle}>📊 カテゴリ別利用額</Text>
                        {selectedCategory && (
                            <TouchableOpacity onPress={() => setSelectedCategory(null)} style={styles.clearFilterButton}>
                                <Text style={styles.clearFilterText}>フィルター解除</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {categoryList.length === 0 ? (
                        <Text style={styles.emptyTextSmall}>この期間のカテゴリ記録はありません</Text>
                    ) : (
                        categoryList.map((item) => {
                            const isCredit = item.category === 'クレカ決済';
                            const baseTotal = item.type === 'minus' ? totalExpenseEffective : totalIncome;
                            const percentage = baseTotal > 0 ? Math.round((item.amount / baseTotal) * 100) : 0;
                            const isSelected = selectedCategory === item.category;

                            return (
                                <TouchableOpacity
                                    key={item.category}
                                    style={[
                                        styles.categoryCard,
                                        isSelected && styles.selectedCategoryCard,
                                        isCredit && { borderColor: '#ffd8a8', backgroundColor: '#fff9db' },
                                    ]}
                                    onPress={() => setSelectedCategory(isSelected ? null : item.category)}
                                >
                                    <View style={styles.categoryCardTop}>
                                        <View style={styles.categoryTitleGroup}>
                                            <Text style={styles.categoryNameText}>
                                                {isSelected ? '✓ ' : ''}{isCredit ? '💳 クレカ決済（次期引落）' : item.category}
                                            </Text>
                                        </View>

                                        <View style={{ alignItems: 'flex-end' }}>
                                            <Text
                                                style={[
                                                    styles.categoryAmountText,
                                                    isCredit ? { color: '#e8590c' } : item.type === 'minus' ? styles.minusText : styles.plusText,
                                                ]}
                                            >
                                                {item.type === 'minus' ? '−' : '＋'}{item.amount.toLocaleString()} 円
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={styles.barBackground}>
                                        <View
                                            style={[
                                                styles.barFill,
                                                {
                                                    width: `${Math.min(percentage, 100)}%`,
                                                    backgroundColor: isCredit ? '#fd7e14' : item.type === 'minus' ? '#ff8787' : '#74c0fc',
                                                },
                                            ]}
                                        />
                                    </View>
                                </TouchableOpacity>
                            );
                        })
                    )}
                </View>

                {/* 5. 固定費設定 */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>📌 毎月の固定費設定</Text>
                    <View style={styles.fixedForm}>
                        <TextInput
                            style={[styles.input, { flex: 2 }]}
                            placeholder="項目名 (例: 家賃)"
                            value={fixedName}
                            onChangeText={setFixedName}
                        />
                        <TextInput
                            style={[styles.input, { flex: 1.5 }]}
                            placeholder="金額"
                            keyboardType="numeric"
                            value={fixedAmount}
                            onChangeText={setFixedAmount}
                        />
                        <TouchableOpacity style={styles.addFixedButton} onPress={handleAddFixed}>
                            <Text style={styles.addFixedText}>追加</Text>
                        </TouchableOpacity>
                    </View>

                    {fixedExpenses.map((item) => (
                        <View key={item.id} style={styles.fixedRow}>
                            <Text style={styles.fixedNameText}>{item.name}</Text>
                            <View style={styles.fixedRight}>
                                <Text style={styles.fixedAmountText}>− {item.amount.toLocaleString()} 円</Text>
                                <TouchableOpacity onPress={() => handleDeleteFixed(item.id)} style={styles.smallDeleteButton}>
                                    <Text style={styles.smallDeleteText}>削除</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))}
                </View>

                {/* 6. 取引・チャージ記録一覧 */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>
                        📝 {selectedCategory ? `「${selectedCategory}」の記録` : '期間内のすべての取引記録'}
                    </Text>

                    {filteredTransactions.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>該当する記録はありません</Text>
                        </View>
                    ) : (
                        filteredTransactions.map((item) => (
                            <View key={item.id} style={styles.card}>
                                <View style={styles.cardInfo}>
                                    <Text style={styles.categoryText}>
                                        {item.type === 'transfer' ? '🔄 資金移動・チャージ' : item.category}
                                    </Text>
                                    <Text style={styles.dateText}>
                                        {new Date(item.date).toLocaleDateString('ja-JP', {
                                            month: 'numeric',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                        {item.type === 'transfer' && ` (${item.fromWallet} ➔ ${item.toWallet})`}
                                        {item.type !== 'transfer' && item.fromWallet && ` [${item.fromWallet}]`}
                                        {item.type !== 'transfer' && item.toWallet && ` [${item.toWallet}]`}
                                    </Text>
                                </View>

                                <View style={styles.cardRight}>
                                    <Text
                                        style={[
                                            styles.amountText,
                                            item.type === 'transfer'
                                                ? { color: '#099268' }
                                                : item.category === 'クレカ決済'
                                                    ? { color: '#e8590c' }
                                                    : item.type === 'minus'
                                                        ? styles.minusText
                                                        : styles.plusText,
                                        ]}
                                    >
                                        {item.type === 'transfer' ? '' : item.type === 'minus' ? '−' : '＋'}{item.amount.toLocaleString()} 円
                                    </Text>

                                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                                        <TouchableOpacity onPress={() => openEditModal(item)} style={styles.editButton}>
                                            <Text style={styles.editButtonText}>編集</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={() => handleDeleteTx(item.id)} style={styles.deleteButton}>
                                            <Text style={styles.deleteButtonText}>削除</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>
                        ))
                    )}
                </View>

                {/* 編集モーダル */}
                <Modal visible={!!editingTx} animationType="slide" transparent>
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <ScrollView>
                                <Text style={styles.modalTitle}>📝 取引の編集</Text>

                                {/* 日時 */}
                                <Text style={styles.label}>日時 (YYYY-MM-DD HH:mm)</Text>
                                <TextInput style={styles.modalInput} value={editDate} onChangeText={setEditDate} />

                                {/* 区分 */}
                                <Text style={styles.label}>区分</Text>
                                <View style={styles.typeRow}>
                                    <TouchableOpacity
                                        style={[styles.typeBtn, editType === 'minus' && styles.typeBtnMinus]}
                                        onPress={() => setEditType('minus')}
                                    >
                                        <Text style={[styles.typeBtnText, editType === 'minus' && styles.whiteText]}>支出</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.typeBtn, editType === 'plus' && styles.typeBtnPlus]}
                                        onPress={() => setEditType('plus')}
                                    >
                                        <Text style={[styles.typeBtnText, editType === 'plus' && styles.whiteText]}>収入</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.typeBtn, editType === 'transfer' && styles.typeBtnTransfer]}
                                        onPress={() => setEditType('transfer')}
                                    >
                                        <Text style={[styles.typeBtnText, editType === 'transfer' && styles.whiteText]}>移動</Text>
                                    </TouchableOpacity>
                                </View>

                                {/* 金額 */}
                                <Text style={styles.label}>金額</Text>
                                <TextInput
                                    style={styles.modalInput}
                                    keyboardType="number-pad"
                                    value={editAmount}
                                    onChangeText={setEditAmount}
                                />

                                {/* カテゴリ */}
                                {editType !== 'transfer' && (
                                    <>
                                        <Text style={styles.label}>カテゴリ</Text>
                                        <TextInput style={styles.modalInput} value={editCategory} onChangeText={setEditCategory} />
                                    </>
                                )}

                                {/* 口座 */}
                                {editType === 'transfer' ? (
                                    <>
                                        <Text style={styles.label}>出金元</Text>
                                        <View style={styles.chipRow}>
                                            {wallets.map((w) => (
                                                <TouchableOpacity
                                                    key={w}
                                                    style={[styles.chip, editFromWallet === w && styles.chipActive]}
                                                    onPress={() => setEditFromWallet(w)}
                                                >
                                                    <Text style={[styles.chipText, editFromWallet === w && styles.whiteText]}>{w}</Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>

                                        <Text style={styles.label}>入金先</Text>
                                        <View style={styles.chipRow}>
                                            {wallets.map((w) => (
                                                <TouchableOpacity
                                                    key={w}
                                                    style={[styles.chip, editToWallet === w && styles.chipActive]}
                                                    onPress={() => setEditToWallet(w)}
                                                >
                                                    <Text style={[styles.chipText, editToWallet === w && styles.whiteText]}>{w}</Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </>
                                ) : (
                                    <>
                                        <Text style={styles.label}>口座</Text>
                                        <View style={styles.chipRow}>
                                            {wallets.map((w) => (
                                                <TouchableOpacity
                                                    key={w}
                                                    style={[styles.chip, editWallet === w && styles.chipActive]}
                                                    onPress={() => setEditWallet(w)}
                                                >
                                                    <Text style={[styles.chipText, editWallet === w && styles.whiteText]}>{w}</Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </>
                                )}

                                {/* ボタン */}
                                <View style={styles.modalBtnRow}>
                                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingTx(null)}>
                                        <Text style={styles.cancelBtnText}>キャンセル</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEdit}>
                                        <Text style={styles.saveBtnText}>変更を保存</Text>
                                    </TouchableOpacity>
                                </View>
                            </ScrollView>
                        </View>
                    </View>
                </Modal>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
        paddingHorizontal: 16,
        paddingTop: 10,
        maxWidth: 480,
        alignSelf: 'center',
        width: '100%',
    },
    paydayBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#edf2ff',
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 8,
        marginBottom: 12,
    },
    paydayText: {
        fontSize: 12,
        color: '#343a40',
    },
    paydayEditButton: {
        backgroundColor: '#3b5bdb',
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: 4,
    },
    paydayEditText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: 'bold',
    },
    paydayForm: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#ffffff',
        padding: 10,
        borderRadius: 8,
        marginBottom: 12,
    },
    paydayFormLabel: {
        fontSize: 12,
        color: '#495057',
    },
    paydayInput: {
        borderWidth: 1,
        borderColor: '#dee2e6',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        width: 50,
        textAlign: 'center',
    },
    paydaySaveButton: {
        backgroundColor: '#3b5bdb',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    paydaySaveText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    monthSelector: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginBottom: 16,
        elevation: 1,
    },
    monthTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#212529',
    },
    monthArrowButton: {
        padding: 6,
    },
    monthArrowText: {
        fontSize: 13,
        color: '#3b5bdb',
        fontWeight: 'bold',
    },
    summaryCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
        elevation: 2,
    },
    summaryTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#495057',
        marginBottom: 12,
    },
    summaryGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    summaryItem: {
        alignItems: 'center',
    },
    summaryLabel: {
        fontSize: 11,
        color: '#868e96',
        marginBottom: 4,
    },
    summaryValue: {
        fontSize: 12,
        fontWeight: 'bold',
    },
    summaryDivider: {
        height: 1,
        backgroundColor: '#f1f3f5',
        marginVertical: 12,
    },
    balanceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    balanceLabel: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#212529',
    },
    balanceValue: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    section: {
        marginBottom: 24,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#212529',
    },
    clearFilterButton: {
        backgroundColor: '#edf2ff',
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 6,
    },
    clearFilterText: {
        color: '#3b5bdb',
        fontSize: 12,
        fontWeight: 'bold',
    },
    emptyTextSmall: {
        color: '#868e96',
        fontSize: 13,
        marginVertical: 8,
    },
    categoryCard: {
        backgroundColor: '#ffffff',
        padding: 12,
        borderRadius: 10,
        marginBottom: 8,
        borderWidth: 1.5,
        borderColor: '#f1f3f5',
    },
    selectedCategoryCard: {
        borderColor: '#3b5bdb',
        backgroundColor: '#f8f9ff',
    },
    categoryCardTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    categoryTitleGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    categoryNameText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#343a40',
    },
    categoryAmountText: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    barBackground: {
        height: 6,
        backgroundColor: '#f1f3f5',
        borderRadius: 3,
        overflow: 'hidden',
    },
    barFill: {
        height: '100%',
        borderRadius: 3,
    },
    fixedForm: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 10,
    },
    input: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#dee2e6',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 14,
    },
    addFixedButton: {
        backgroundColor: '#3b5bdb',
        paddingHorizontal: 16,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 8,
    },
    addFixedText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    fixedRow: {
        backgroundColor: '#ffffff',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
        borderWidth: 1,
        borderColor: '#f1f3f5',
    },
    fixedNameText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#343a40',
    },
    fixedRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    fixedAmountText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#e03131',
    },
    smallDeleteButton: {
        backgroundColor: '#fff5f5',
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 4,
    },
    smallDeleteText: {
        color: '#e03131',
        fontSize: 11,
    },
    emptyContainer: {
        paddingVertical: 20,
        alignItems: 'center',
    },
    emptyText: {
        color: '#868e96',
        fontSize: 14,
    },
    card: {
        backgroundColor: '#ffffff',
        padding: 14,
        borderRadius: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
        elevation: 1,
    },
    cardInfo: {
        gap: 2,
        flex: 1,
    },
    categoryText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#343a40',
    },
    dateText: {
        fontSize: 11,
        color: '#868e96',
    },
    cardRight: {
        alignItems: 'flex-end',
        gap: 4,
    },
    amountText: {
        fontSize: 15,
        fontWeight: 'bold',
    },
    minusText: {
        color: '#e03131',
    },
    plusText: {
        color: '#1971c2',
    },
    editButton: {
        backgroundColor: '#edf2ff',
        paddingVertical: 3,
        paddingHorizontal: 6,
        borderRadius: 4,
    },
    editButtonText: {
        color: '#1971c2',
        fontSize: 10,
        fontWeight: 'bold',
    },
    deleteButton: {
        backgroundColor: '#f1f3f5',
        paddingVertical: 3,
        paddingHorizontal: 6,
        borderRadius: 4,
    },
    deleteButtonText: {
        color: '#868e96',
        fontSize: 10,
    },
    // モーダル用スタイル
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    modalContent: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 20,
        width: '100%',
        maxHeight: '85%',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 14,
    },
    label: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#495057',
        marginTop: 10,
        marginBottom: 4,
    },
    modalInput: {
        borderWidth: 1,
        borderColor: '#dee2e6',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 14,
    },
    typeRow: {
        flexDirection: 'row',
        gap: 8,
    },
    typeBtn: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        backgroundColor: '#f1f3f5',
        borderRadius: 6,
    },
    typeBtnMinus: { backgroundColor: '#e03131' },
    typeBtnPlus: { backgroundColor: '#1971c2' },
    typeBtnTransfer: { backgroundColor: '#099268' },
    typeBtnText: { fontSize: 13, fontWeight: 'bold', color: '#495057' },
    whiteText: { color: '#ffffff' },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    chip: {
        paddingVertical: 6,
        paddingHorizontal: 10,
        backgroundColor: '#f1f3f5',
        borderRadius: 12,
    },
    chipActive: {
        backgroundColor: '#3b5bdb',
    },
    chipText: {
        fontSize: 12,
        color: '#495057',
    },
    modalBtnRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 20,
    },
    cancelBtn: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        backgroundColor: '#f1f3f5',
        borderRadius: 8,
    },
    cancelBtnText: {
        color: '#495057',
        fontWeight: 'bold',
    },
    saveBtn: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        backgroundColor: '#3b5bdb',
        borderRadius: 8,
    },
    saveBtnText: {
        color: '#ffffff',
        fontWeight: 'bold',
    },
});