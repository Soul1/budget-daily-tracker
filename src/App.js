import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Layout,
  Card,
  InputNumber,
  Input,
  Button,
  Typography,
  Table,
  Space,
  message,
  DatePicker,
  Divider,
  Tag,
} from "antd";
import { PlusOutlined, MinusOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

/**********************
 * IndexedDB storage  *
 **********************/
const DB_NAME = "budgetDB";
const DB_VERSION = 1;
const STORE_NAME = "budgetStore";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Store will use keyPath 'id' so we can store one record with id='state'
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadState() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get("state");
    getReq.onsuccess = () => resolve(getReq.result || null);
    getReq.onerror = () => reject(getReq.error);
  });
}

async function saveState(state) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(STORE_NAME);
    store.put({ id: "state", ...state });
  });
}

/**********************
 * Helpers & defaults *
 **********************/
function defaultPeriod() {
  return [dayjs().startOf("month"), dayjs().endOf("month")];
}

function toISOPeriod(period) {
  if (!period || !period[0] || !period[1]) return null;
  return [period[0].toISOString(), period[1].toISOString()];
}

function fromISOPeriod(iso) {
  if (!iso || !iso[0] || !iso[1]) return defaultPeriod();
  return [dayjs(iso[0]), dayjs(iso[1])];
}

function computeDaysLeft(period) {
  if (!period || !period[0] || !period[1]) return 0;
  const today = dayjs().startOf("day");
  const start = dayjs(period[0]).startOf("day");
  const end = dayjs(period[1]).endOf("day");
  const effectiveStart = today.isAfter(start) ? today : start;
  if (end.isBefore(effectiveStart)) return 0;
  return end.diff(effectiveStart, "day") + 1; // inclusive of today
}

function formatAmount(n) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "RUB",
    }).format(n);
  } catch {
    return String(n);
  }
}

function newTxnId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**********************
 * Context & Provider *
 **********************/
const AppContext = createContext(null);
const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
};

function AppProvider({ children }) {
  const [balance, setBalance] = useState();
  const [transactions, setTransactions] = useState([]); // {id, dateISO, type:'add'|'sub', amount, reason}
  const [period, setPeriod] = useState(defaultPeriod());
  const [hydrated, setHydrated] = useState(false);

  // hydrate
  useEffect(() => {
    (async () => {
      try {
        const saved = await loadState();
        if (saved) {
          if (typeof saved.balance === "number") setBalance(saved.balance);
          if (Array.isArray(saved.transactions))
            setTransactions(saved.transactions);
          if (saved.period) setPeriod(fromISOPeriod(saved.period));
        }
      } catch (e) {
        // noop, keep defaults
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // persist
  useEffect(() => {
    if (!hydrated) return; // avoid overwriting before first load
    const state = {
      balance,
      transactions,
      period: toISOPeriod(period),
    };
    saveState(state).catch(() => {});
  }, [balance, transactions, period, hydrated]);

  const daysLeft = useMemo(() => computeDaysLeft(period), [period]);
  const dailyLimit = useMemo(
    () => (daysLeft > 0 ? +(balance / daysLeft).toFixed(2) : 0),
    [balance, daysLeft]
  );

  const addTransaction = (rawAmount, reason) => {
    const amount = Number(rawAmount) || 0;
    if (!amount) return;
    const type = amount >= 0 ? "add" : "sub";
    const signed = amount; // signed value, could be negative
    const next = {
      id: newTxnId(),
      dateISO: new Date().toISOString(),
      type,
      amount: Math.abs(signed),
      reason: reason?.trim() || "",
    };
    setBalance((b) => b + signed);
    setTransactions((prev) => [next, ...prev]);
    message.success(
      `Транзакция ${type === "add" ? "+" : "-"}${Math.abs(amount)}${
        next.reason ? ` (${next.reason})` : ""
      }`
    );
  };

  const resetAll = () => {
    setBalance(undefined);
    setTransactions([]);
    setPeriod(defaultPeriod());
    message.info("Сброшено к значениям по умолчанию");
  };

  const value = {
    balance,
    setBalance,
    transactions,
    addTransaction,
    period,
    setPeriod,
    daysLeft,
    dailyLimit,
    resetAll,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/****************
 * UI Components *
 ****************/
const { Title, Paragraph, Text } = Typography;

function BalanceInput() {
  const { setBalance } = useApp();
  const [value, setValue] = useState();

  const handleSave = () => {
    setBalance(Number(value) || undefined);
    setValue(); // clear after submit
  };

  return (
    <Card title="Введите стартовый баланс" className="mb-3">
      <Space>
        <InputNumber
          value={value}
          min={0}
          onChange={(v) => setValue(v ?? 0)}
          placeholder="Сумма"
        />
        <Button type="primary" onClick={handleSave}>
          Сохранить
        </Button>
      </Space>
    </Card>
  );
}

function PeriodSelector() {
  const { period, setPeriod, daysLeft } = useApp();

  return (
    <Card title="Период учёта" className="mb-3">
      <Space direction="vertical" style={{ width: "100%" }}>
        <DatePicker.RangePicker
          value={period}
          onChange={(vals) =>
            vals && vals[0] && vals[1]
              ? setPeriod(vals)
              : setPeriod(defaultPeriod())
          }
          allowClear={false}
        />
        <Text type={daysLeft > 0 ? "secondary" : "danger"}>
          Дней до конца периода: <b>{daysLeft}</b>
        </Text>
      </Space>
    </Card>
  );
}

function DailyLimitCard() {
  const { balance, dailyLimit } = useApp();
  return (
    <Card>
      <Paragraph>
        Текущий баланс: <b>{formatAmount(balance)}</b>
      </Paragraph>
      <Paragraph>
        Дневной лимит: <b>{formatAmount(dailyLimit)}</b>
      </Paragraph>
    </Card>
  );
}

function BalanceControls() {
  const { addTransaction } = useApp();
  const [amount, setAmount] = useState();
  const [reason, setReason] = useState("");

  const onAdd = () => {
    addTransaction(Number(amount), reason);
    setAmount(undefined);
    setReason("");
  };
  const onSub = () => {
    addTransaction(-Number(amount), reason);
    setAmount(undefined);
    setReason("");
  };

  return (
    <Card title="Управление балансом" className="mb-3">
      <Space direction="vertical" style={{ width: 360 }}>
        <InputNumber
          value={amount}
          onChange={(v) => setAmount(v ?? 0)}
          placeholder="Сумма"
          style={{ width: "100%" }}
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина (необязательно)"
        />
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
            Добавить
          </Button>
          <Button danger icon={<MinusOutlined />} onClick={onSub}>
            Убавить
          </Button>
        </Space>
      </Space>
    </Card>
  );
}

function TransactionHistory() {
  const { transactions } = useApp();

  const columns = [
    {
      title: "Дата",
      dataIndex: "dateISO",
      key: "date",
      render: (v) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "Тип",
      dataIndex: "type",
      key: "type",
      render: (t) =>
        t === "add" ? (
          <Tag color="green">Пополнение</Tag>
        ) : (
          <Tag color="red">Списание</Tag>
        ),
    },
    {
      title: "Сумма",
      dataIndex: "amount",
      key: "amount",
      render: (a, row) => (row.type === "add" ? "+" : "-") + formatAmount(a),
    },
    { title: "Причина", dataIndex: "reason", key: "reason" },
  ];

  return (
    <Card title="История операций">
      <Table
        dataSource={transactions}
        columns={columns}
        pagination={{ pageSize: 10 }}
        rowKey={(r) => r.id}
        sticky
      />
    </Card>
  );
}

function HeaderBar() {
  const { resetAll } = useApp();
  return (
    <Space
      align="center"
      style={{
        width: "100%",
        justifyContent: "space-between",
        marginBottom: 12,
      }}
    >
      <Title level={2} style={{ margin: 0 }}>
        Budget Daily Tracker
      </Title>
      <Button icon={<ReloadOutlined />} onClick={resetAll}>
        Сбросить всё
      </Button>
    </Space>
  );
}

/********
 * App  *
 ********/
export default function App() {
  return (
    <AppProvider>
      <Layout style={{ minHeight: "100vh", padding: 20 }}>
        <HeaderBar />
        <BalanceInput />
        <PeriodSelector />
        <DailyLimitCard />
        <Divider />
        <BalanceControls />
        <TransactionHistory />
      </Layout>
    </AppProvider>
  );
}
