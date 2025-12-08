"use client";

import { useEffect, useState } from "react";
import { UserTask, getUserTasks } from "@/lib/api/userTasks";

const statusClasses: Record<UserTask["status"], string> = {
  Sent: "bg-amber-50 text-amber-700 border-amber-200",
  "No Response": "bg-rose-50 text-rose-700 border-rose-200",
  Accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Completed: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function UserTasksPage() {
  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const phone = typeof window !== "undefined" ? localStorage.getItem("kk_phone") || "" : "";

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getUserTasks(phone);
        setTasks(data);
      } catch (err) {
        console.error(err);
        setError("Unable to load your tasks right now.");
      } finally {
        setLoading(false);
      }
    };
    if (phone) {
      load();
    } else {
      setLoading(false);
      setError("No phone found. Please log in again.");
    }
  }, [phone]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Your Tasks</p>
        <h1 className="text-2xl font-semibold text-slate-900">Task History</h1>
        <p className="text-sm text-slate-600">
          These are the tasks you have created on Kaun Karega.
        </p>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Loading your tasks...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Task ID</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Area</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                {tasks.map((task) => (
                  <tr key={task.taskId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{task.taskId}</td>
                    <td className="px-4 py-3">{task.category}</td>
                    <td className="px-4 py-3">{task.area}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                          statusClasses[task.status] ||
                          "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {task.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center text-sm text-slate-500"
                    >
                      You have not created any tasks yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
