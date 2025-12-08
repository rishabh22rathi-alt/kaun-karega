export default function AdminDashboardPage() {
  const [stats, setStats] = useState({
    totalTasks: 0,
    providerResponses: 0,
    activeChats: 0,
    closedChats: 0,
    totalReviews: 0,
  });
  const [loading, setLoading] = useState(false);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stats");
      const data = await res.json();
      if (data.ok && data.stats) {
        setStats(data.stats);
      }
    } catch (err) {
      // silently ignore for now
    } finally {
      setLoading(false);
    }
  };

  const cards = [
    { title: "Total Tasks", value: stats.totalTasks },
    { title: "Provider Responses", value: stats.providerResponses },
    { title: "Active Chats", value: stats.activeChats },
    { title: "Closed Chats", value: stats.closedChats },
    { title: "Total Reviews", value: stats.totalReviews },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Welcome, Admin 👋</h1>
        <p className="text-gray-600 mt-1">Here’s your platform overview:</p>
      </div>

      <div className="flex justify-center my-4">
        <button
          type="button"
          onClick={fetchStats}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700"
        >
          🔄 Refresh Data
        </button>
      </div>
      {loading && (
        <p className="text-center text-sm text-gray-600">Refreshing...</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.title}
            className="bg-white rounded-lg shadow-md p-4 border border-gray-100"
          >
            <p className="text-sm font-semibold text-gray-500">{card.title}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
