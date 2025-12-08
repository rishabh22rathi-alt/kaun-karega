"use client";

import { useEffect, useState } from "react";

type ChatRow = {
  roomId: string;
  taskId: string;
  userPhone: string;
  providerPhone: string;
  status: string;
  createdAt: string;
  expiresAt: string;
};

export default function AdminChatsPage() {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    const perms = JSON.parse(localStorage.getItem("kk_permissions") || "[]");
    setPermissions(perms);
    if (!perms.includes("view_chats")) {
      setLoading(false);
      return;
    }
    const fetchChats = async () => {
      try {
        const res = await fetch("/api/admin/chats");
        const data = await res.json();
        if (data.ok) {
          setChats(data.chats || []);
        } else {
          setError("Error loading data");
        }
      } catch (err) {
        setError("Error loading data");
      } finally {
        setLoading(false);
      }
    };
    fetchChats();
  }, []);

  if (!permissions.includes("view_chats")) {
    return (
      <p className="text-red-500 text-sm">
        You do not have permission to view this section.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Chat Rooms</h1>
      <div className="bg-white rounded-lg shadow p-4 border border-gray-100">
        {loading ? (
          <p className="text-sm text-gray-600">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : chats.length === 0 ? (
          <p className="text-sm text-gray-600">No records found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-gray-700">
              <thead>
                <tr className="text-blue-600 font-semibold border-b">
                  <th className="text-left py-2 pr-4">Room ID</th>
                  <th className="text-left py-2 pr-4">Task ID</th>
                  <th className="text-left py-2 pr-4">User Phone</th>
                  <th className="text-left py-2 pr-4">Provider Phone</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2 pr-4">Created At</th>
                  <th className="text-left py-2 pr-4">Expires At</th>
                  <th className="text-left py-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {chats.map((row) => (
                  <tr
                    key={row.roomId}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="py-2 pr-4">{row.roomId}</td>
                    <td className="py-2 pr-4">{row.taskId}</td>
                    <td className="py-2 pr-4">{row.userPhone}</td>
                    <td className="py-2 pr-4">{row.providerPhone}</td>
                    <td className="py-2 pr-4 uppercase">{row.status}</td>
                    <td className="py-2 pr-4">{row.createdAt}</td>
                    <td className="py-2 pr-4">{row.expiresAt}</td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={() =>
                          window.open(`/chat/${row.roomId}`, "_blank")
                        }
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded"
                      >
                        Open Chat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
