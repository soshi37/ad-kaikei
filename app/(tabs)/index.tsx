import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path } from 'react-native-svg';

// --- 型定義 ---
type Transaction = {
  id: string;
  amount: number;
  type: 'minus' | 'plus' | 'transfer';
  category: string;
  fromWallet?: string;
  toWallet?: string;
  date: string;
};

type Wallet = {
  id: string;
  name: string;
  balance: number;
};

type RecurringRule = {
  id: string;
  title: string;
  amount: number;
  type: 'minus' | 'plus';
  category: string;
  walletName: string;
  dayOfMonth: number; // 毎月何日 (1〜31)
};

const DEFAULT_WALLETS: Wallet[] = [
  { id: '1', name: '現金', balance: 0 },
  { id: '2', name: '銀行口座', balance: 0 },
  { id: '3', name: 'PayPay', balance: 0 },
  { id: '4', name: 'Suica', balance: 0 },
  { id: '5', name: 'クレジットカード', balance: 0 },
];

const DEFAULT_EXPENSE_CATEGORIES = ['食費', '日用品', '交通費', '交際費', '趣味', 'クレカ決済', 'その他'];
const DEFAULT_INCOME_CATEGORIES = ['給料', 'お小遣い', '副業', '臨時収入', 'その他'];

const CHART_COLORS = [
  '#e03131', '#1971c2', '#099268', '#f59f00', '#9c36b5',
  '#d6336c', '#2f9e44', '#1098ad', '#748ffc', '#f783ac',
];

// SVG形式の円グラフコンポーネント
const CustomPieChart = ({
  data,
  colors,
  size = 200,
  innerRadiusRatio = 0.6,
}: {
  data: number[];
  colors: string[];
  size?: number;
  innerRadiusRatio?: number;
}) => {
  const total = data.reduce((sum, val) => sum + val, 0);
  if (total === 0 || data.length === 0) return null;

  const center = size / 2;
  const outerRadius = size / 2;
  const innerRadius = outerRadius * innerRadiusRatio;

  let cumulativeAngle = 0;

  if (data.length === 1) {
    return (
      <Svg width={size} height={size}>
        <G>
          <Circle cx={center} cy={center} r={outerRadius} fill={colors[0] || '#3b5bdb'} />
          <Circle cx={center} cy={center} r={innerRadius} fill="#ffffff" />
        </G>
      </Svg>
    );
  }

  const slices = data.map((value, index) => {
    const angle = (value / total) * 360;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + angle;
    cumulativeAngle += angle;

    const startRad = (Math.PI / 180) * (startAngle - 90);
    const endRad = (Math.PI / 180) * (endAngle - 90);

    const x1 = center + outerRadius * Math.cos(startRad);
    const y1 = center + outerRadius * Math.sin(startRad);
    const x2 = center + outerRadius * Math.cos(endRad);
    const y2 = center + outerRadius * Math.sin(endRad);

    const x3 = center + innerRadius * Math.cos(endRad);
    const y3 = center + innerRadius * Math.sin(endRad);
    const x4 = center + innerRadius * Math.cos(startRad);
    const y4 = center + innerRadius * Math.sin(startRad);

    const largeArcFlag = angle > 180 ? 1 : 0;

    const pathData = [
      `M ${x1} ${y1}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x4} ${y4}`,
      'Z',
    ].join(' ');

    return <Path key={index} d={pathData} fill={colors[index % colors.length]} />;
  });

  return (
    <Svg width={size} height={size}>
      <G>{slices}</G>
    </Svg>
  );
};

export default function HomeScreen() {
  const [wallets, setWallets] = useState<Wallet[]>(DEFAULT_WALLETS);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // クレカ自動引き落とし設定
  const [creditCardWithdrawalDay, setCreditCardWithdrawalDay] = useState<number>(27);
  const [withdrawalSourceWallet, setWithdrawalSourceWallet] = useState<string>('銀行口座');

  // 電卓入力用
  const [calcDisplay, setCalcDisplay] = useState('0');
  const [showCalculator, setShowCalculator] = useState(false);

  const [expenseCategories, setExpenseCategories] = useState<string[]>(DEFAULT_EXPENSE_CATEGORIES);
  const [incomeCategories, setIncomeCategories] = useState<string[]>(DEFAULT_INCOME_CATEGORIES);

  const [transactionType, setTransactionType] = useState<'minus' | 'plus' | 'transfer'>('minus');
  const [selectedCategory, setSelectedCategory] = useState(DEFAULT_EXPENSE_CATEGORIES[0]);

  // 移動（チャージ）用ウォレット選択
  const [fromWallet, setFromWallet] = useState('現金');
  const [toWallet, setToWallet] = useState('Suica');
  const [selectedWallet, setSelectedWallet] = useState('現金');

  // Modal / Form 開閉管理
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [showChartModal, setShowChartModal] = useState(false);
  const [chartType, setChartType] = useState<'minus' | 'plus'>('minus');

  // 集計用表示月 (YYYY-MM 形式) と締め日設定 (デフォルト: 15日始まり)
  const [currentMonth, setCurrentMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );
  const [startDay, setStartDay] = useState<number>(15);

  // 入力用 State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newWalletName, setNewWalletName] = useState('');

  // 固定費ルール用 State
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);
  const [recTitle, setRecTitle] = useState('');
  const [recAmount, setRecAmount] = useState('');
  const [recType, setRecType] = useState<'minus' | 'plus'>('minus');
  const [recCategory, setRecCategory] = useState(DEFAULT_EXPENSE_CATEGORIES[0]);
  const [recWallet, setRecWallet] = useState('銀行口座');
  const [recDay, setRecDay] = useState('25');

  // 5秒間取り消し（Undo）用 State & Ref
  const [undoTx, setUndoTx] = useState<Transaction | null>(null);
  const [showUndo, setShowUndo] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const storedWithdrawalDay = await AsyncStorage.getItem('@credit_withdrawal_day');
      const currentWithdrawalDay = storedWithdrawalDay ? Number(storedWithdrawalDay) : 27;
      setCreditCardWithdrawalDay(currentWithdrawalDay);

      const storedWithdrawalSource = await AsyncStorage.getItem('@credit_withdrawal_source');
      const currentWithdrawalSource = storedWithdrawalSource || '銀行口座';
      setWithdrawalSourceWallet(currentWithdrawalSource);

      const storedStartDay = await AsyncStorage.getItem('@chart_start_day');
      if (storedStartDay) setStartDay(Number(storedStartDay));

      const storedWallets = await AsyncStorage.getItem('@custom_wallets');
      let baseWallets: Wallet[] = storedWallets ? JSON.parse(storedWallets) : DEFAULT_WALLETS;

      if (!baseWallets.some((w) => w.name === 'クレジットカード')) {
        baseWallets.push({ id: '5', name: 'クレジットカード', balance: 0 });
      }

      const storedExpCat = await AsyncStorage.getItem('@custom_expense_categories');
      if (storedExpCat) {
        const parsed: string[] = JSON.parse(storedExpCat);
        if (!parsed.includes('クレカ決済')) parsed.push('クレカ決済');
        setExpenseCategories(parsed);
      }

      const storedIncCat = await AsyncStorage.getItem('@custom_income_categories');
      if (storedIncCat) setIncomeCategories(JSON.parse(storedIncCat));

      const storedRules = await AsyncStorage.getItem('@recurring_rules');
      const loadedRules: RecurringRule[] = storedRules ? JSON.parse(storedRules) : [];
      setRecurringRules(loadedRules);

      const storedTx = await AsyncStorage.getItem('@transactions');
      let txList: Transaction[] = storedTx ? JSON.parse(storedTx) : [];

      txList = await checkAndExecuteRecurringRules(txList, loadedRules);
      txList = await checkAndExecuteAutoWithdrawal(
        txList,
        currentWithdrawalDay,
        currentWithdrawalSource
      );

      setTransactions(txList);

      const walletBalances: Record<string, number> = {};
      baseWallets.forEach((w) => (walletBalances[w.name] = 0));

      txList.forEach((tx) => {
        if (tx.type === 'plus' && tx.toWallet) {
          walletBalances[tx.toWallet] = (walletBalances[tx.toWallet] || 0) + tx.amount;
        } else if (tx.type === 'minus' && tx.fromWallet) {
          walletBalances[tx.fromWallet] = (walletBalances[tx.fromWallet] || 0) - tx.amount;
        } else if (tx.type === 'transfer' && tx.fromWallet && tx.toWallet) {
          walletBalances[tx.fromWallet] = (walletBalances[tx.fromWallet] || 0) - tx.amount;
          walletBalances[tx.toWallet] = (walletBalances[tx.toWallet] || 0) + tx.amount;
        }
      });

      const updatedWallets = baseWallets.map((w) => ({
        ...w,
        balance: walletBalances[w.name] || 0,
      }));

      setWallets(updatedWallets);
    } catch (e) {
      console.error(e);
    }
  };

  const checkAndExecuteRecurringRules = async (
    currentTxList: Transaction[],
    rules: RecurringRule[]
  ): Promise<Transaction[]> => {
    if (rules.length === 0) return currentTxList;

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonthNum = today.getMonth() + 1;
    const currentDate = today.getDate();

    const storedLastRun = await AsyncStorage.getItem('@last_recurring_run_log');
    const lastRunLog: Record<string, string> = storedLastRun ? JSON.parse(storedLastRun) : {};

    let newTxAdded: Transaction[] = [];
    let executedCount = 0;

    rules.forEach((rule) => {
      const logKey = `${rule.id}_${currentYear}_${currentMonthNum}`;
      if (currentDate >= rule.dayOfMonth && !lastRunLog[logKey]) {
        const autoTx: Transaction = {
          id: Date.now().toString() + Math.random().toString().slice(2, 6),
          amount: rule.amount,
          type: rule.type,
          category: rule.category,
          fromWallet: rule.type === 'minus' ? rule.walletName : undefined,
          toWallet: rule.type === 'plus' ? rule.walletName : undefined,
          date: new Date().toISOString(),
        };

        newTxAdded.push(autoTx);
        lastRunLog[logKey] = new Date().toISOString();
        executedCount++;
      }
    });

    if (executedCount > 0) {
      const updatedTxList = [...newTxAdded, ...currentTxList];
      await AsyncStorage.setItem('@transactions', JSON.stringify(updatedTxList));
      await AsyncStorage.setItem('@last_recurring_run_log', JSON.stringify(lastRunLog));

      Alert.alert('自動登録完了', `${executedCount}件の定期収支（固定費・給料等）を自動記録しました。`);
      return updatedTxList;
    }

    return currentTxList;
  };

  const checkAndExecuteAutoWithdrawal = async (
    currentTxList: Transaction[],
    day: number,
    sourceWallet: string
  ): Promise<Transaction[]> => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonthNum = today.getMonth() + 1;
    const currentDate = today.getDate();

    const currentMonthKey = `${currentYear}-${currentMonthNum}`;
    const lastExecutedMonth = await AsyncStorage.getItem('@last_auto_withdrawal_month');

    if (currentDate >= day && lastExecutedMonth !== currentMonthKey) {
      let creditBalance = 0;
      currentTxList.forEach((tx) => {
        if (tx.type === 'minus' && tx.fromWallet === 'クレジットカード') {
          creditBalance -= tx.amount;
        } else if (tx.type === 'plus' && tx.toWallet === 'クレジットカード') {
          creditBalance += tx.amount;
        } else if (tx.type === 'transfer') {
          if (tx.fromWallet === 'クレジットカード') creditBalance -= tx.amount;
          if (tx.toWallet === 'クレジットカード') creditBalance += tx.amount;
        }
      });

      if (creditBalance < 0) {
        const payoffAmount = Math.abs(creditBalance);

        const autoTx: Transaction = {
          id: Date.now().toString(),
          amount: payoffAmount,
          type: 'transfer',
          category: '自動引き落とし',
          fromWallet: sourceWallet,
          toWallet: 'クレジットカード',
          date: new Date().toISOString(),
        };

        const updatedTxList = [autoTx, ...currentTxList];
        await AsyncStorage.setItem('@transactions', JSON.stringify(updatedTxList));
        await AsyncStorage.setItem('@last_auto_withdrawal_month', currentMonthKey);

        Alert.alert(
          '自動引き落とし完了',
          `今月分（${day}日）のクレカ利用分 ${payoffAmount.toLocaleString()}円 を${sourceWallet}から返済処理しました。`
        );

        return updatedTxList;
      }
    }

    return currentTxList;
  };

  const handleSaveSettings = async () => {
    await AsyncStorage.setItem('@credit_withdrawal_day', String(creditCardWithdrawalDay));
    await AsyncStorage.setItem('@credit_withdrawal_source', withdrawalSourceWallet);
    setShowSettings(false);
    Alert.alert('設定完了', '引き落とし設定を保存しました。');
    loadData();
  };

  const handleSaveStartDay = async (day: number) => {
    setStartDay(day);
    await AsyncStorage.setItem('@chart_start_day', String(day));
  };

  const handleAddRecurringRule = async () => {
    const amountNum = Number(recAmount);
    const dayNum = Number(recDay);

    if (!recTitle.trim() || isNaN(amountNum) || amountNum <= 0 || isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
      Alert.alert('入力エラー', '正しい項目名、金額、日付（1〜31日）を入力してください。');
      return;
    }

    const newRule: RecurringRule = {
      id: Date.now().toString(),
      title: recTitle.trim(),
      amount: amountNum,
      type: recType,
      category: recCategory,
      walletName: recWallet,
      dayOfMonth: dayNum,
    };

    const updated = [...recurringRules, newRule];
    setRecurringRules(updated);
    await AsyncStorage.setItem('@recurring_rules', JSON.stringify(updated));

    setRecTitle('');
    setRecAmount('');
    Alert.alert('登録完了', '固定費ルールを追加しました。');
    loadData();
  };

  const handleDeleteRecurringRule = async (id: string) => {
    const updated = recurringRules.filter((r) => r.id !== id);
    setRecurringRules(updated);
    await AsyncStorage.setItem('@recurring_rules', JSON.stringify(updated));
  };

  const handleExportCSV = async () => {
    if (transactions.length === 0) {
      Alert.alert('データなし', '出力する取引データがありません。');
      return;
    }

    try {
      let csvContent = 'ID,日付,種別,カテゴリ,金額,出金元,入金先\n';

      transactions.forEach((tx) => {
        const dateStr = new Date(tx.date).toLocaleString('ja-JP');
        const typeStr = tx.type === 'minus' ? '支出' : tx.type === 'plus' ? '収入' : '移動';
        const from = tx.fromWallet || '';
        const to = tx.toWallet || '';

        csvContent += `"${tx.id}","${dateStr}","${typeStr}","${tx.category}",${tx.amount},"${from}","${to}"\n`;
      });

      const fileName = `AD_Accounting_Export_${new Date().toISOString().slice(0, 10)}.csv`;

      if (Platform.OS === 'web') {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      const fileUri = `${FileSystem.documentDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(fileUri, csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert('出力完了', `ファイルが保存されました: ${fileUri}`);
      }
    } catch (e) {
      Alert.alert('エラー', 'CSVの出力に失敗しました。');
      console.error(e);
    }
  };

  const handleTypeChange = (type: 'minus' | 'plus' | 'transfer') => {
    setTransactionType(type);
    if (type === 'minus') setSelectedCategory(expenseCategories[0] || 'その他');
    if (type === 'plus') setSelectedCategory(incomeCategories[0] || 'その他');
  };

  const handleCalcPress = (val: string) => {
    if (val === 'C') {
      setCalcDisplay('0');
      return;
    }
    if (val === '⌫') {
      setCalcDisplay((prev) => (prev.length <= 1 ? '0' : prev.slice(0, -1)));
      return;
    }
    if (val === '=') {
      try {
        const sanitized = calcDisplay.replace(/×/g, '*').replace(/÷/g, '/').replace(/[+\-*/]$/, '');
        const result = Function(`'use strict'; return (${sanitized})`)();
        setCalcDisplay(String(Math.floor(result)));
      } catch (e) {
        setCalcDisplay('0');
      }
      return;
    }

    if (['+', '−', '×', '÷'].includes(val)) {
      const lastChar = calcDisplay.slice(-1);
      if (['+', '−', '×', '÷'].includes(lastChar)) {
        setCalcDisplay(calcDisplay.slice(0, -1) + val);
      } else {
        setCalcDisplay(calcDisplay + val);
      }
      return;
    }

    setCalcDisplay((prev) => (prev === '0' ? val : prev + val));
  };

  const handleAddCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;

    if (transactionType === 'minus') {
      if (!expenseCategories.includes(trimmed)) {
        const updated = [...expenseCategories, trimmed];
        setExpenseCategories(updated);
        await AsyncStorage.setItem('@custom_expense_categories', JSON.stringify(updated));
      }
    } else {
      if (!incomeCategories.includes(trimmed)) {
        const updated = [...incomeCategories, trimmed];
        setIncomeCategories(updated);
        await AsyncStorage.setItem('@custom_income_categories', JSON.stringify(updated));
      }
    }
    setSelectedCategory(trimmed);
    setNewCategoryName('');
    setIsAddingCategory(false);
  };

  const handleAddWallet = async () => {
    const trimmed = newWalletName.trim();
    if (!trimmed) return;

    if (wallets.some((w) => w.name === trimmed)) return;

    const newW: Wallet = { id: Date.now().toString(), name: trimmed, balance: 0 };
    const updated = [...wallets, newW];
    setWallets(updated);
    await AsyncStorage.setItem('@custom_wallets', JSON.stringify(updated));

    setNewWalletName('');
  };

  const handleSave = async () => {
    let finalAmount = 0;
    try {
      const sanitized = calcDisplay.replace(/×/g, '*').replace(/÷/g, '/').replace(/[+\-*/]$/, '');
      finalAmount = Math.floor(Function(`'use strict'; return (${sanitized})`)());
    } catch (e) {
      finalAmount = 0;
    }

    if (isNaN(finalAmount) || finalAmount <= 0) return;

    const newTx: Transaction = {
      id: Date.now().toString(),
      amount: finalAmount,
      type: transactionType,
      category: transactionType === 'transfer' ? 'チャージ/移動' : selectedCategory,
      fromWallet: transactionType === 'plus' ? undefined : transactionType === 'transfer' ? fromWallet : selectedWallet,
      toWallet: transactionType === 'minus' ? undefined : transactionType === 'transfer' ? toWallet : selectedWallet,
      date: new Date().toISOString(),
    };

    try {
      const storedTx = await AsyncStorage.getItem('@transactions');
      const txList = storedTx ? JSON.parse(storedTx) : [];
      const updatedTx = [newTx, ...txList];

      await AsyncStorage.setItem('@transactions', JSON.stringify(updatedTx));

      setCalcDisplay('0');
      setShowCalculator(false);
      loadData();

      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoTx(newTx);
      setShowUndo(true);

      undoTimerRef.current = setTimeout(() => {
        setShowUndo(false);
        setUndoTx(null);
      }, 5000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUndo = async () => {
    if (!undoTx) return;

    try {
      const storedTx = await AsyncStorage.getItem('@transactions');
      if (storedTx) {
        const list: Transaction[] = JSON.parse(storedTx);
        const filtered = list.filter((t) => t.id !== undoTx.id);
        await AsyncStorage.setItem('@transactions', JSON.stringify(filtered));
      }

      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setShowUndo(false);
      setUndoTx(null);

      loadData();
      Alert.alert('取り消し完了', '直前の記録を取り消しました。');
    } catch (e) {
      Alert.alert('エラー', '取り消しに失敗しました。');
    }
  };

  const handlePrevMonth = () => {
    const [year, month] = currentMonth.split('-').map(Number);
    const date = new Date(year, month - 2, 1);
    const prevYear = date.getFullYear();
    const prevMonth = String(date.getMonth() + 1).padStart(2, '0');
    setCurrentMonth(`${prevYear}-${prevMonth}`);
  };

  const handleNextMonth = () => {
    const [year, month] = currentMonth.split('-').map(Number);
    const date = new Date(year, month, 1);
    const nextYear = date.getFullYear();
    const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
    setCurrentMonth(`${nextYear}-${nextMonth}`);
  };

  const getChartData = () => {
    const [year, month] = currentMonth.split('-').map(Number);

    let startDate: Date;
    let endDate: Date;

    if (startDay === 1) {
      startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
      endDate = new Date(year, month, 0, 23, 59, 59, 999);
    } else {
      startDate = new Date(year, month - 2, startDay, 0, 0, 0, 0);
      endDate = new Date(year, month - 1, startDay - 1, 23, 59, 59, 999);
    }

    const categoryTotals: Record<string, number> = {};

    transactions
      .filter((tx) => {
        if (tx.type !== chartType) return false;
        const txDate = new Date(tx.date);
        return txDate >= startDate && txDate <= endDate;
      })
      .forEach((tx) => {
        categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
      });

    const categories = Object.keys(categoryTotals);
    const series = categories.map((cat) => categoryTotals[cat]);
    const totalSum = series.reduce((a, b) => a + b, 0);

    const sliceColor = categories.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

    const startStr = `${startDate.getMonth() + 1}/${startDate.getDate()}`;
    const endStr = `${endDate.getMonth() + 1}/${endDate.getDate()}`;
    const dateRangeLabel = `${startStr} ~ ${endStr}`;

    return { categories, series, sliceColor, totalSum, categoryTotals, dateRangeLabel };
  };

  const chartData = getChartData();
  const currentTotalAsset = wallets.reduce((sum, w) => sum + w.balance, 0);
  const currentCategories = transactionType === 'minus' ? expenseCategories : incomeCategories;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8f9fa' }} edges={['top', 'left', 'right', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 }}>
            {/* 1. 総資産＆口座別残高カード */}
            <View style={styles.assetCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.assetTitle}>現在の総資産</Text>
                <TouchableOpacity onPress={() => setShowSettings(!showSettings)}>
                  <Text style={{ color: '#dbe4ff', fontSize: 12, textDecorationLine: 'underline' }}>
                    ⚙ 引き落とし設定
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.assetAmount}>{currentTotalAsset.toLocaleString()} 円</Text>

              {showSettings && (
                <View style={styles.settingsBox}>
                  <Text style={styles.settingsTitle}>💳 クレカ自動引き落とし設定</Text>
                  <Text style={styles.settingsLabel}>引き落とし日（毎月何日？）</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <TextInput
                      style={styles.settingsInput}
                      keyboardType="number-pad"
                      value={String(creditCardWithdrawalDay)}
                      onChangeText={(val) => setCreditCardWithdrawalDay(Number(val) || 1)}
                    />
                    <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>日</Text>
                  </View>

                  <Text style={styles.settingsLabel}>引き落とし元口座</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {wallets
                      .filter((w) => w.name !== 'クレジットカード')
                      .map((w) => (
                        <TouchableOpacity
                          key={w.id}
                          style={[
                            styles.settingsChip,
                            withdrawalSourceWallet === w.name && styles.settingsChipActive,
                          ]}
                          onPress={() => setWithdrawalSourceWallet(w.name)}
                        >
                          <Text style={styles.settingsChipText}>{w.name}</Text>
                        </TouchableOpacity>
                      ))}
                  </View>

                  <TouchableOpacity style={styles.settingsSaveBtn} onPress={handleSaveSettings}>
                    <Text style={styles.settingsSaveBtnText}>設定を保存する</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.walletGrid}>
                {wallets.map((w) => (
                  <View key={w.id} style={styles.walletBadge}>
                    <Text style={styles.walletName}>{w.name}</Text>
                    <Text style={styles.walletBalance}>{w.balance.toLocaleString()}円</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* サブ機能メニューバー */}
            <View style={styles.subMenuBar}>
              <TouchableOpacity style={styles.subMenuBtn} onPress={() => setShowRecurringModal(true)}>
                <Text style={styles.subMenuBtnText}>🔄 固定費設定</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.subMenuBtn} onPress={() => setShowChartModal(true)}>
                <Text style={styles.subMenuBtnText}>📊 月別円グラフ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.subMenuBtn} onPress={handleExportCSV}>
                <Text style={styles.subMenuBtnText}>📁 CSV出力</Text>
              </TouchableOpacity>
            </View>

            {/* 2. メイン入力フォーム */}
            <View style={styles.inputCard}>
              <View style={styles.typeSelector}>
                <TouchableOpacity
                  style={[styles.typeButton, transactionType === 'minus' && styles.typeButtonMinusActive]}
                  onPress={() => handleTypeChange('minus')}
                >
                  <Text style={[styles.typeButtonText, transactionType === 'minus' && styles.typeTextActive]}>支出</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, transactionType === 'plus' && styles.typeButtonPlusActive]}
                  onPress={() => handleTypeChange('plus')}
                >
                  <Text style={[styles.typeButtonText, transactionType === 'plus' && styles.typeTextActive]}>収入</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, transactionType === 'transfer' && styles.typeButtonTransferActive]}
                  onPress={() => handleTypeChange('transfer')}
                >
                  <Text style={[styles.typeButtonText, transactionType === 'transfer' && styles.typeTextActive]}>
                    🔄 移動/チャージ
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>金額（タップして入力）</Text>
              <TouchableOpacity
                style={[styles.amountDisplayCard, showCalculator && styles.amountDisplayCardActive]}
                onPress={() => setShowCalculator(true)}
              >
                <Text style={styles.amountDisplayText}>{calcDisplay}</Text>
                <Text style={styles.amountCurrencyText}>円</Text>
              </TouchableOpacity>

              {transactionType === 'transfer' ? (
                <View style={styles.transferBox}>
                  <Text style={styles.label}>出金元 (どこから)</Text>
                  <View style={styles.categoryContainer}>
                    {wallets.map((w) => (
                      <TouchableOpacity
                        key={w.id}
                        style={[styles.categoryChip, fromWallet === w.name && styles.categoryChipActive]}
                        onPress={() => setFromWallet(w.name)}
                      >
                        <Text style={[styles.categoryChipText, fromWallet === w.name && styles.categoryChipTextActive]}>
                          {w.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[styles.label, { marginTop: 10 }]}>入金先 (どこへチャージ？)</Text>
                  <View style={styles.categoryContainer}>
                    {wallets.map((w) => (
                      <TouchableOpacity
                        key={w.id}
                        style={[styles.categoryChip, toWallet === w.name && styles.categoryChipActive]}
                        onPress={() => setToWallet(w.name)}
                      >
                        <Text style={[styles.categoryChipText, toWallet === w.name && styles.categoryChipTextActive]}>
                          {w.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : (
                <>
                  <Text style={styles.label}>決済・使用する口座（ウォレット）</Text>
                  <View style={styles.categoryContainer}>
                    {wallets.map((w) => (
                      <TouchableOpacity
                        key={w.id}
                        style={[styles.categoryChip, selectedWallet === w.name && styles.categoryChipActive]}
                        onPress={() => setSelectedWallet(w.name)}
                      >
                        <Text
                          style={[styles.categoryChipText, selectedWallet === w.name && styles.categoryChipTextActive]}
                        >
                          {w.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.label}>カテゴリ</Text>
                  <View style={styles.categoryContainer}>
                    {currentCategories.map((cat) => (
                      <TouchableOpacity
                        key={cat}
                        style={[
                          styles.categoryChip,
                          selectedCategory === cat && styles.categoryChipActive,
                          cat === 'クレカ決済' && styles.creditChip,
                          selectedCategory === 'クレカ決済' && cat === 'クレカ決済' && styles.creditChipActive,
                        ]}
                        onPress={() => setSelectedCategory(cat)}
                      >
                        <Text
                          style={[
                            styles.categoryChipText,
                            selectedCategory === cat && styles.categoryChipTextActive,
                            cat === 'クレカ決済' && { color: '#e8590c' },
                            selectedCategory === 'クレカ決済' && cat === 'クレカ決済' && { color: '#ffffff' },
                          ]}
                        >
                          {cat === 'クレカ決済' ? '💳 クレカ決済' : cat}
                        </Text>
                      </TouchableOpacity>
                    ))}

                    <TouchableOpacity
                      style={styles.addCategoryChip}
                      onPress={() => setIsAddingCategory(!isAddingCategory)}
                    >
                      <Text style={styles.addCategoryChipText}>＋ 項目追加</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {isAddingCategory && (
                <View style={styles.addCategoryForm}>
                  <TextInput
                    style={styles.addCategoryInput}
                    placeholder="新しいカテゴリ名"
                    value={newCategoryName}
                    onChangeText={setNewCategoryName}
                  />
                  <TouchableOpacity style={styles.addCategoryButton} onPress={handleAddCategory}>
                    <Text style={styles.addCategoryButtonText}>追加</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.addWalletBox}>
                <TextInput
                  style={styles.addWalletInput}
                  placeholder="新しい決済手段（例: au PAY, 楽天Edy）"
                  value={newWalletName}
                  onChangeText={setNewWalletName}
                />
                <TouchableOpacity style={styles.addWalletButton} onPress={handleAddWallet}>
                  <Text style={styles.addWalletButtonText}>口座追加</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.saveButton,
                  transactionType === 'plus'
                    ? styles.saveButtonPlus
                    : transactionType === 'transfer'
                    ? styles.saveButtonTransfer
                    : styles.saveButtonMinus,
                ]}
                onPress={handleSave}
              >
                <Text style={styles.saveButtonText}>
                  {transactionType === 'minus'
                    ? '支出を記録する'
                    : transactionType === 'plus'
                    ? '収入を記録する'
                    : '資金移動・チャージを実行'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* 5秒間Undoトースト */}
        {showUndo && (
          <View style={styles.undoToast}>
            <View>
              <Text style={styles.undoTitle}>記録しました</Text>
              <Text style={styles.undoSubText}>5秒以内なら取り消せます</Text>
            </View>
            <TouchableOpacity onPress={handleUndo} style={styles.undoButton}>
              <Text style={styles.undoButtonText}>↩ 元に戻す</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* モーダル: 電卓 */}
        {showCalculator && (
          <View style={styles.calculatorModal}>
            <View style={styles.calcHeader}>
              <Text style={styles.calcHeaderTitle}>金額入力</Text>
              <TouchableOpacity onPress={() => setShowCalculator(false)} style={styles.calcCloseButton}>
                <Text style={styles.calcCloseText}>完了 ✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.calcDisplayBox}>
              <Text style={styles.calcDisplayText}>{calcDisplay} 円</Text>
            </View>

            <View style={styles.keypadGrid}>
              {[
                ['C', '⌫', '÷', '×'],
                ['7', '8', '9', '−'],
                ['4', '5', '6', '+'],
                ['1', '2', '3', '='],
                ['0', '00', '確定'],
              ].map((row, rowIndex) => (
                <View key={rowIndex} style={styles.keypadRow}>
                  {row.map((btn) => {
                    const isOp = ['÷', '×', '−', '+', '='].includes(btn);
                    const isAction = ['C', '⌫'].includes(btn);
                    const isSubmit = btn === '確定';

                    return (
                      <TouchableOpacity
                        key={btn}
                        style={[
                          styles.keyButton,
                          isOp && styles.keyOp,
                          isAction && styles.keyAction,
                          isSubmit && styles.keySubmit,
                          btn === '0' && { flex: 1 },
                        ]}
                        onPress={() => {
                          if (isSubmit) {
                            setShowCalculator(false);
                          } else {
                            handleCalcPress(btn);
                          }
                        }}
                      >
                        <Text
                          style={[
                            styles.keyText,
                            isOp && styles.keyOpText,
                            isAction && styles.keyActionText,
                            isSubmit && styles.keySubmitText,
                          ]}
                        >
                          {btn}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* モーダル: 固定費（定期収支）設定 */}
        <Modal visible={showRecurringModal} animationType="slide" transparent={false} presentationStyle="pageSheet">
          <SafeAreaView style={styles.modalContainer} edges={['top', 'left', 'right', 'bottom']}>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>🔄 固定費・定期収支の設定</Text>
                <TouchableOpacity onPress={() => setShowRecurringModal(false)}>
                  <Text style={styles.modalCloseText}>閉じる ✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex: 1 }}>
                <View style={styles.modalFormBox}>
                  <Text style={styles.label}>名称（例: 家賃, サブスク, 給料）</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="名称を入力"
                    value={recTitle}
                    onChangeText={setRecTitle}
                  />

                  <View style={{ flexDirection: 'row', gap: 10, marginVertical: 10 }}>
                    <TouchableOpacity
                      style={[styles.typeButton, recType === 'minus' && styles.typeButtonMinusActive]}
                      onPress={() => {
                        setRecType('minus');
                        setRecCategory(expenseCategories[0] || 'その他');
                      }}
                    >
                      <Text style={[styles.typeButtonText, recType === 'minus' && styles.typeTextActive]}>支出</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.typeButton, recType === 'plus' && styles.typeButtonPlusActive]}
                      onPress={() => {
                        setRecType('plus');
                        setRecCategory(incomeCategories[0] || 'その他');
                      }}
                    >
                      <Text style={[styles.typeButtonText, recType === 'plus' && styles.typeTextActive]}>収入</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.label}>毎月の実行日（1〜31日）</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="25"
                    keyboardType="number-pad"
                    value={recDay}
                    onChangeText={setRecDay}
                  />

                  <Text style={styles.label}>金額</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="金額を入力"
                    keyboardType="number-pad"
                    value={recAmount}
                    onChangeText={setRecAmount}
                  />

                  <Text style={styles.label}>カテゴリ</Text>
                  <View style={styles.categoryContainer}>
                    {(recType === 'minus' ? expenseCategories : incomeCategories).map((c) => (
                      <TouchableOpacity
                        key={c}
                        style={[styles.categoryChip, recCategory === c && styles.categoryChipActive]}
                        onPress={() => setRecCategory(c)}
                      >
                        <Text style={[styles.categoryChipText, recCategory === c && styles.categoryChipTextActive]}>
                          {c}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.label}>対象口座</Text>
                  <View style={styles.categoryContainer}>
                    {wallets.map((w) => (
                      <TouchableOpacity
                        key={w.id}
                        style={[styles.categoryChip, recWallet === w.name && styles.categoryChipActive]}
                        onPress={() => setRecWallet(w.name)}
                      >
                        <Text style={[styles.categoryChipText, recWallet === w.name && styles.categoryChipTextActive]}>
                          {w.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleAddRecurringRule}>
                    <Text style={styles.modalSubmitBtnText}>固定費ルールを追加</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.label, { marginTop: 20 }]}>登録済みの固定費一覧</Text>
                {recurringRules.length === 0 ? (
                  <Text style={{ color: '#868e96', fontSize: 13, marginVertical: 10 }}>ルールがありません</Text>
                ) : (
                  recurringRules.map((item) => (
                    <View key={item.id} style={styles.ruleCard}>
                      <View>
                        <Text style={styles.ruleTitle}>
                          {item.title} ({item.type === 'minus' ? '支出' : '収入'})
                        </Text>
                        <Text style={styles.ruleSub}>
                          毎月 {item.dayOfMonth} 日 / {item.category} / {item.walletName}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={[styles.ruleAmount, { color: item.type === 'minus' ? '#e03131' : '#1971c2' }]}>
                          {item.amount.toLocaleString()}円
                        </Text>
                        <TouchableOpacity onPress={() => handleDeleteRecurringRule(item.id)}>
                          <Text style={{ color: '#e03131', fontSize: 12 }}>削除</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>

        {/* モーダル: 月別円グラフ分析 */}
        <Modal visible={showChartModal} animationType="slide" transparent={false} presentationStyle="pageSheet">
          <SafeAreaView style={styles.modalContainer} edges={['top', 'left', 'right', 'bottom']}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>📊 集計・円グラフ内訳</Text>
              <TouchableOpacity onPress={() => setShowChartModal(false)}>
                <Text style={styles.modalCloseText}>閉じる ✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.monthSelector}>
              <TouchableOpacity style={styles.monthNavBtn} onPress={handlePrevMonth}>
                <Text style={styles.monthNavText}>◀ 前月</Text>
              </TouchableOpacity>

              <View style={{ alignItems: 'center' }}>
                <Text style={styles.monthTitleText}>
                  {currentMonth.split('-')[0]}年 {Number(currentMonth.split('-')[1])}月
                </Text>
                <Text style={{ fontSize: 11, color: '#495057', fontWeight: 'bold' }}>
                  ({chartData.dateRangeLabel})
                </Text>
              </View>

              <TouchableOpacity style={styles.monthNavBtn} onPress={handleNextMonth}>
                <Text style={styles.monthNavText}>次月 ▶</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16, backgroundColor: '#e7f5ff', padding: 8, borderRadius: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#1864ab' }}>集計開始日:</Text>
              <TextInput
                style={{
                  backgroundColor: '#ffffff',
                  borderWidth: 1,
                  borderColor: '#74c0fc',
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  fontSize: 12,
                  fontWeight: 'bold',
                  width: 40,
                  textAlign: 'center',
                }}
                keyboardType="number-pad"
                value={String(startDay)}
                onChangeText={(val) => {
                  const num = Number(val);
                  if (!isNaN(num) && num >= 1 && num <= 31) {
                    handleSaveStartDay(num);
                  } else if (val === '') {
                    setStartDay(1);
                  }
                }}
              />
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#1864ab' }}>日始まり（例: 15日始まり＝9/15~10/14）</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
              <TouchableOpacity
                style={[styles.typeButton, chartType === 'minus' && styles.typeButtonMinusActive]}
                onPress={() => setChartType('minus')}
              >
                <Text style={[styles.typeButtonText, chartType === 'minus' && styles.typeTextActive]}>支出内訳</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeButton, chartType === 'plus' && styles.typeButtonPlusActive]}
                onPress={() => setChartType('plus')}
              >
                <Text style={[styles.typeButtonText, chartType === 'plus' && styles.typeTextActive]}>収入内訳</Text>
              </TouchableOpacity>
            </View>

            {chartData.series.length === 0 ? (
              <Text style={{ textAlign: 'center', color: '#868e96', marginTop: 40 }}>
                {chartData.dateRangeLabel} の記録はありません。
              </Text>
            ) : (
              <ScrollView style={{ flex: 1 }}>
                <View style={{ alignItems: 'center', marginVertical: 20 }}>
                  <CustomPieChart
                    size={200}
                    data={chartData.series}
                    colors={chartData.sliceColor}
                    innerRadiusRatio={0.6}
                  />
                  <Text style={{ fontSize: 18, fontWeight: 'bold', marginTop: 16 }}>
                    合計 {chartType === 'minus' ? '支出' : '収入'}: {chartData.totalSum.toLocaleString()} 円
                  </Text>
                </View>

                <View style={{ gap: 8, marginTop: 10 }}>
                  {chartData.categories.map((cat, idx) => {
                    const amt = chartData.categoryTotals[cat];
                    const percent = ((amt / chartData.totalSum) * 100).toFixed(1);

                    return (
                      <View key={cat} style={styles.chartLegendRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: 7,
                              backgroundColor: chartData.sliceColor[idx],
                            }}
                          />
                          <Text style={{ fontSize: 14, fontWeight: '600' }}>{cat}</Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: 'bold' }}>
                          {amt.toLocaleString()} 円 ({percent}%)
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  assetCard: {
    backgroundColor: '#3b5bdb',
    padding: 20,
    borderRadius: 16,
    marginBottom: 12,
    elevation: 2,
  },
  assetTitle: {
    color: '#dbe4ff',
    fontSize: 13,
    fontWeight: '600',
  },
  assetAmount: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 4,
    marginBottom: 14,
  },
  settingsBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
  },
  settingsTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  settingsLabel: {
    color: '#dbe4ff',
    fontSize: 11,
    marginBottom: 4,
  },
  settingsInput: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    width: 60,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  settingsChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  settingsChipActive: {
    backgroundColor: '#1971c2',
  },
  settingsChipText: {
    color: '#ffffff',
    fontSize: 11,
  },
  settingsSaveBtn: {
    backgroundColor: '#2b8a3e',
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  settingsSaveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  walletGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  walletBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    minWidth: '45%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  walletName: {
    color: '#edf2ff',
    fontSize: 12,
  },
  walletBalance: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  subMenuBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 6,
  },
  subMenuBtn: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  subMenuBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#495057',
  },
  inputCard: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 16,
    elevation: 2,
  },
  typeSelector: {
    flexDirection: 'row',
    backgroundColor: '#f1f3f5',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  typeButtonMinusActive: {
    backgroundColor: '#e03131',
  },
  typeButtonPlusActive: {
    backgroundColor: '#1971c2',
  },
  typeButtonTransferActive: {
    backgroundColor: '#099268',
  },
  typeButtonText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#495057',
  },
  typeTextActive: {
    color: '#ffffff',
  },
  label: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#495057',
    marginBottom: 8,
  },
  amountDisplayCard: {
    backgroundColor: '#f8f9fa',
    borderWidth: 2,
    borderColor: '#dee2e6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  amountDisplayCardActive: {
    borderColor: '#3b5bdb',
    backgroundColor: '#edf2ff',
  },
  amountDisplayText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#212529',
  },
  amountCurrencyText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#868e96',
  },
  transferBox: {
    backgroundColor: '#e6fcf5',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  categoryContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  categoryChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#f1f3f5',
  },
  categoryChipActive: {
    backgroundColor: '#3b5bdb',
  },
  creditChip: {
    backgroundColor: '#fff4e6',
    borderWidth: 1,
    borderColor: '#ffd8a8',
  },
  creditChipActive: {
    backgroundColor: '#e8590c',
    borderColor: '#e8590c',
  },
  categoryChipText: {
    fontSize: 13,
    color: '#495057',
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: '#ffffff',
  },
  addCategoryChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#3b5bdb',
    borderStyle: 'dashed',
    backgroundColor: '#edf2ff',
  },
  addCategoryChipText: {
    fontSize: 13,
    color: '#3b5bdb',
    fontWeight: 'bold',
  },
  addCategoryForm: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  addCategoryInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#ffffff',
  },
  addCategoryButton: {
    backgroundColor: '#3b5bdb',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 8,
  },
  addCategoryButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  addWalletBox: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginBottom: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f3f5',
  },
  addWalletInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 13,
  },
  addWalletButton: {
    backgroundColor: '#495057',
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 8,
  },
  addWalletButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  saveButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  saveButtonMinus: {
    backgroundColor: '#e03131',
  },
  saveButtonPlus: {
    backgroundColor: '#1971c2',
  },
  saveButtonTransfer: {
    backgroundColor: '#099268',
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  undoToast: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    backgroundColor: '#212529',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 6,
    zIndex: 999,
  },
  undoTitle: { color: '#ffffff', fontSize: 13, fontWeight: 'bold' },
  undoSubText: { color: '#adb5bd', fontSize: 11 },
  undoButton: {
    backgroundColor: '#ff6b6b',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  undoButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
  calculatorModal: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 30,
    elevation: 10,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
    zIndex: 1000,
  },
  calcHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  calcHeaderTitle: { fontSize: 14, fontWeight: 'bold', color: '#868e96' },
  calcCloseButton: {
    backgroundColor: '#f1f3f5',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  calcCloseText: { fontSize: 13, fontWeight: 'bold', color: '#495057' },
  calcDisplayBox: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 12,
    alignItems: 'flex-end',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  calcDisplayText: { fontSize: 26, fontWeight: 'bold', color: '#212529' },
  keypadGrid: { gap: 8 },
  keypadRow: { flexDirection: 'row', gap: 8 },
  keyButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#f1f3f5',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyText: { fontSize: 18, fontWeight: 'bold', color: '#212529' },
  keyOp: { backgroundColor: '#edf2ff' },
  keyOpText: { color: '#3b5bdb' },
  keyAction: { backgroundColor: '#fff5f5' },
  keyActionText: { color: '#e03131' },
  keySubmit: { flex: 2, backgroundColor: '#3b5bdb' },
  keySubmitText: { color: '#ffffff' },
  modalContainer: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: '#ffffff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#212529' },
  modalCloseText: { fontSize: 14, fontWeight: 'bold', color: '#e03131' },
  monthSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f1f3f5',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  monthNavBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    elevation: 1,
  },
  monthNavText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#3b5bdb',
  },
  monthTitleText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212529',
  },
  modalFormBox: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  modalInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  modalSubmitBtn: {
    backgroundColor: '#099268',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  modalSubmitBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  ruleCard: {
    backgroundColor: '#f1f3f5',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ruleTitle: { fontWeight: 'bold', fontSize: 14 },
  ruleSub: { color: '#868e96', fontSize: 11, marginTop: 2 },
  ruleAmount: { fontWeight: 'bold', fontSize: 14 },
  chartLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f5',
  },
});