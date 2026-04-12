import React from "react";
import { auth } from "@clerk/nextjs/server";
import { BilingualClause } from "@/types/bilingual";
import BilingualEditorLayout from "@/components/bilingual/BilingualEditorLayout";
import { getServerApiBase } from "@/lib/server-api-base";

export default async function BilingualEditorPage({ params }: { params: Promise<{ contractId: string }> }) {
  const { contractId } = await params;
  const { getToken } = await auth();
  const token = await getToken();
  const apiUrl = getServerApiBase();
  
  let initialClauses: BilingualClause[] = [];
  let fetchError = null;

  try {
    const res = await fetch(`${apiUrl}/api/v1/bilingual/${contractId}/clauses`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      },
      cache: "no-store"
    });

    if (res.ok) {
      const result = await res.json();
      initialClauses = result.data || [];
    } else {
      fetchError = "Failed to load contract clauses. Ensure you have proper permissions.";
    }
  } catch (err) {
    console.error("Error fetching clauses:", err);
    fetchError = "Could not connect to the server.";
  }

  if (fetchError) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0a] text-gray-200">
        <div className="text-center space-y-4">
          <div className="text-red-500 text-6xl">⚠️</div>
          <h1 className="text-xl font-bold">{fetchError}</h1>
          <p className="text-gray-500">Please try again later or contact support.</p>
        </div>
      </div>
    );
  }

  return <BilingualEditorLayout contractId={contractId} initialClauses={initialClauses} />;
}
