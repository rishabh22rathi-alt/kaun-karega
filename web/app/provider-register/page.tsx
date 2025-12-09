"use client";

"use client";
import { FormEvent, useMemo, useState } from "react";

const SERVICE_OPTIONS = [
  "Plumber",
  "Electrician",
  "Carpenter",
  "Painter",
  "AC Repair",
  "Refrigerator Repair",
  "Maid / House Help",
  "Cook",
  "Gardener",
  "Driver",
  "Delivery Boy",
  "Tutor",
  "Computer Repair",
  "CCTV Installation",
  "Welder",
  "Mechanic",
  "Other",
];

const AREA_SUGGESTIONS = [
  "Pratap Nagar",
  "Guro Ka Taalab",
  "Arihant Nagar",
  "K N Nagar",
  "HUDCO",
  "Devi Road",
  "Dau kki Dhaani",
];

export default function ProviderRegisterPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [customService, setCustomService] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [areaInput, setAreaInput] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const showCustomService = selectedServices.includes("Other");

  const resolvedServices = useMemo(() => {
    if (!showCustomService) {
      return selectedServices;
    }
    const trimmed = customService.trim();
    return selectedServices.map((service) =>
      service === "Other" ? trimmed : service
    );
  }, [selectedServices, showCustomService, customService]);

  const toggleService = (service: string) => {
    setSelectedServices((prev) => {
      if (prev.includes(service)) {
        if (service === "Other") {
          setCustomService("");
        }
        return prev.filter((item) => item !== service);
      }

      if (prev.length >= 5) {
        setError("You can select up to 5 services.");
        return prev;
      }

      setError("");
      return [...prev, service];
    });
  };

  const toggleArea = (area: string) => {
    setAreas((prev) => {
      if (prev.includes(area)) {
        return prev.filter((item) => item !== area);
      }

      if (prev.length >= 10) {
        setError("You can select up to 10 areas.");
        return prev;
      }

      setError("");
      return [...prev, area];
    });
  };

  const addManualArea = () => {
    const trimmed = areaInput.trim();
    if (!trimmed) {
      setError("Enter an area before adding.");
      return;
    }

    if (areas.length >= 10) {
      setError("You can select up to 10 areas.");
      return;
    }

    if (areas.some((area) => area.toLowerCase() === trimmed.toLowerCase())) {
      setError("Area already added.");
      return;
    }

    setAreas((prev) => [...prev, trimmed]);
    setAreaInput("");
    setError("");
  };

  const removeArea = (area: string) => {
    setAreas((prev) => prev.filter((item) => item !== area));
  };

  const removeService = (service: string) => {
    setSelectedServices((prev) => prev.filter((item) => item !== service));
    if (service === "Other") {
      setCustomService("");
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Full Name is required.");
      setMessage("");
      return;
    }

    if (!phone.trim()) {
      setError("Mobile Number is required.");
      setMessage("");
      return;
    }

    if (selectedServices.length === 0) {
      setError("Select at least one service.");
      setMessage("");
      return;
    }

    if (showCustomService && !customService.trim()) {
      setError("Enter your service when selecting Other.");
      setMessage("");
      return;
    }

    if (areas.length === 0) {
      setError("Select at least one service area.");
      setMessage("");
      return;
    }

    if (resolvedServices.some((service) => !service)) {
      setError("Custom service cannot be empty.");
      setMessage("");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/providers/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          categories: resolvedServices,
          areas,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setMessage("Provider profile submitted successfully!");
        setName("");
        setPhone("");
        setSelectedServices([]);
        setCustomService("");
        setAreas([]);
        setAreaInput("");
      } else {
        setError("Failed to submit details. Please try again.");
      }
    } catch (err) {
      setError("Network error. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white shadow-xl rounded-2xl p-6 md:p-10">
        <h1 className="text-2xl md:text-3xl font-bold text-center mb-6">
          Service Provider Registration
        </h1>

        {message && (
          <p className="mb-4 text-green-600 text-center font-semibold">
            {message}
          </p>
        )}
        {error && (
          <p className="mb-4 text-red-600 text-center font-semibold">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name*
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="Enter your full name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mobile Number*
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))
                }
                className="w-full rounded-lg border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="10-digit mobile number"
                inputMode="numeric"
              />
            </div>

            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">
                  Service Categories* (select up to 5)
                </label>
                <span className="text-xs text-gray-500">
                  {selectedServices.length}/5 selected
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {SERVICE_OPTIONS.map((service) => {
                  const isSelected = selectedServices.includes(service);
                  return (
                    <button
                      key={service}
                      type="button"
                      onClick={() => toggleService(service)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        isSelected
                          ? "border-black bg-black text-white"
                          : "border-gray-300 hover:border-black"
                      }`}
                    >
                      {service}
                    </button>
                  );
                })}
              </div>
              {selectedServices.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedServices.map((service) => (
                    <span
                      key={service}
                      className="flex items-center gap-2 rounded-full bg-gray-200 px-3 py-1 text-sm"
                    >
                      {service === "Other" && customService.trim()
                        ? customService.trim()
                        : service}
                      <button
                        type="button"
                        onClick={() => removeService(service)}
                        className="text-gray-600 hover:text-black"
                      >
                        A-
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {showCustomService && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Enter your service*
                  </label>
                  <input
                    type="text"
                    value={customService}
                    onChange={(e) => setCustomService(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-black"
                    placeholder="Describe your service"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Service Areas* (select up to 10)
              </label>
              <span className="text-xs text-gray-500">
                {areas.length}/10 selected
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {AREA_SUGGESTIONS.map((area) => {
                const isSelected = areas.includes(area);
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => toggleArea(area)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      isSelected
                        ? "border-black bg-black text-white"
                        : "border-gray-300 hover:border-black"
                    }`}
                  >
                    {area}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={areaInput}
                onChange={(e) => setAreaInput(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="Add another area manually"
              />
              <button
                type="button"
                onClick={addManualArea}
                className="rounded-lg bg-black text-white px-4 py-3 font-semibold hover:opacity-90"
              >
                Add Area
              </button>
            </div>
            {areas.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {areas.map((area) => (
                  <span
                    key={area}
                    className="flex items-center gap-2 rounded-full bg-gray-200 px-3 py-1 text-sm"
                  >
                    {area}
                    <button
                      type="button"
                      onClick={() => removeArea(area)}
                      className="text-gray-600 hover:text-black"
                    >
                      A-
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white py-3 rounded-lg font-semibold hover:opacity-90 disabled:opacity-60 transition"
          >
            {loading ? "Submitting..." : "Submit Details"}
          </button>
        </form>
      </div>
    </main>
  );
}
