import { findProvidersByCategoryAndArea } from '@/lib/googleSheets';
import SubcategoryBadges from "@/components/SubcategoryBadges";

type ConfirmationPageProps = {
  searchParams: Promise<{ category?: string; area?: string; status?: string }>;
};

export default async function ConfirmationPage({
  searchParams,
}: ConfirmationPageProps) {
  const params = await searchParams;
  const category = params.category ?? "";
  const area = params.area ?? "";
  const status = params.status ?? "";
  const showProviders = (params as { show?: string }).show === "1";

  let providers: string[][] = [];
  if (showProviders && category && area) {
    providers = await findProvidersByCategoryAndArea(category, area);
  }

  const yesHref = `/confirmation?category=${encodeURIComponent(category)}&area=${encodeURIComponent(area)}&show=1`;

  if (status === "pending_approval") {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 text-center bg-white">
        <div className="flex flex-col items-center w-full max-w-xl">
          <div className="text-5xl mb-4">?</div>
          <h1 className="text-2xl font-bold text-slate-900">
            Request Sent for Approval
          </h1>
          <p className="mt-4 text-gray-600">
            Thank you for your interest. Currently we are not providing this
            service, but your request has been submitted for admin approval and
            you will get updates shortly.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex rounded-lg bg-sky-500 px-6 py-2 text-white"
          >
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-center bg-white">
      <div className="flex flex-col items-center w-full max-w-xl">
        <div className="text-5xl mb-4">?</div>
        <h1 className="text-2xl font-bold text-slate-900">Task Posted Successfully!</h1>
        <p className="mt-2 text-gray-600">
          Local professionals have been notified.
        </p>
        <div className="mt-6 w-full">
          <SubcategoryBadges />
        </div>

        {!showProviders ? (
          <div className="mt-8 p-6 border rounded-xl shadow-sm bg-blue-50 w-full">
            <p className="mb-4 font-semibold text-slate-900">
              Would you like to contact matched providers directly?
            </p>
            <div className="flex gap-4 justify-center">
              <a
                href={yesHref}
                className="bg-sky-500 text-white px-6 py-2 rounded-lg"
              >
                Yes, show them
              </a>
              <a
                href="/"
                className="bg-gray-200 px-6 py-2 rounded-lg"
              >
                No, I'll wait
              </a>
            </div>
          </div>
        ) : (
          <div className="mt-8 w-full max-w-md">
            <h2 className="font-bold mb-4 text-slate-900">
              Available Providers in {area}:
            </h2>
            {providers.length > 0 ? (
              providers.map((p, i) => {
                const name = p?.[1] || `Provider ${i + 1}`;
                const phone = p?.[2] || "";
                const digits = phone.toString().replace(/\D/g, "");
                return (
                  <div
                    key={`${name}-${i}`}
                    className="p-4 border-b flex justify-between items-center"
                  >
                    <span className="text-slate-900 font-medium">{name}</span>
                    <a
                      href={`https://wa.me/${digits}`}
                      className="text-green-600 font-bold"
                    >
                      Chat on WhatsApp
                    </a>
                  </div>
                );
              })
            ) : (
              <p className="text-slate-700">
                Providers are reviewing your task. You will be notified shortly!
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
