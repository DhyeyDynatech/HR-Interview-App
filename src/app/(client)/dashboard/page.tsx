"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth.context";
import InterviewCard from "@/components/dashboard/interview/interviewCard";
import CreateInterviewModal from "@/components/dashboard/interview/createInterviewModal";
import { InterviewService } from "@/services/interviews.service";
import { ResponseService } from "@/services/responses.service";
import { useInterviews } from "@/contexts/interviews.context";
import Modal from "@/components/dashboard/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gem, LayoutGrid, List, Plus, Search } from "lucide-react";
import Image from "next/image";

function Interviews() {
  const { interviews, interviewsLoading } = useInterviews();
  const { user } = useAuth();
  const [loading, setLoading] = useState<boolean>(false);
  const [currentPlan, setCurrentPlan] = useState<string>("");
  const [allowedResponsesCount, setAllowedResponsesCount] =
    useState<number>(10);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  function InterviewsLoader() {
    return (
      <>
        <div className="h-40 w-52 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-40 w-52 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-40 w-52 animate-pulse rounded-lg bg-gray-200" />
      </>
    );
  }

  useEffect(() => {
    const fetchResponsesCount = async () => {
      if (!user?.id || currentPlan !== "free") {
        return;
      }

      setLoading(true);
      try {
        const totalResponses = await ResponseService.getResponseCountByUserId(user.id);
        const hasExceededLimit = totalResponses >= allowedResponsesCount;
        if (hasExceededLimit) {
          setCurrentPlan("free_trial_over");
          await InterviewService.deactivateInterviewsByOrgId(user.id);
        }
      } catch (error) {
        console.error("Error fetching responses:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchResponsesCount();
  }, [user?.id, currentPlan, allowedResponsesCount]);


  return (
    <main className="p-6 w-full rounded-md">
      <div className="flex flex-col w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              My Interviews
            </h2>
            <h3 className="text-sm tracking-tight text-gray-600 font-medium">
              Start getting responses now!
            </h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Search interviews..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-56"
              />
            </div>
            <div className="flex border rounded-md overflow-hidden">
              <button
                type="button"
                title="Grid view"
                onClick={() => setViewMode('grid')}
                className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                title="List view"
                onClick={() => setViewMode('list')}
                className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                <List size={16} />
              </button>
            </div>
            {currentPlan !== "free_trial_over" && (
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Interview
              </Button>
            )}
          </div>
        </div>
        <div className={viewMode === 'grid' ? "flex flex-wrap gap-4" : "flex flex-col gap-2"}>
          {interviewsLoading || loading ? (
            <InterviewsLoader />
          ) : (
            <>
              {isModalOpen && (
                <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)}>
                  <div className="flex flex-col space-y-4">
                    <div className="flex justify-center text-indigo-600">
                      <Gem />
                    </div>
                    <h3 className="text-xl font-semibold text-center">
                      Upgrade to Pro
                    </h3>
                    <p className="text-l text-center">
                      You have reached your limit for the free trial. Please
                      upgrade to pro to continue using our features.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex justify-center items-center">
                        <Image
                          src={"/premium-plan-icon.png"}
                          alt="Graphic"
                          width={299}
                          height={300}
                        />
                      </div>

                      <div className="grid grid-rows-2 gap-2">
                        <div className="p-4 border rounded-lg">
                          <h4 className="text-lg font-medium">Free Plan</h4>
                          <ul className="list-disc pl-5 mt-2">
                            <li>10 Responses</li>
                            <li>Basic Support</li>
                            <li>Limited Features</li>
                          </ul>
                        </div>
                        <div className="p-4 border rounded-lg">
                          <h4 className="text-lg font-medium">Pro Plan</h4>
                          <ul className="list-disc pl-5 mt-2">
                            <li>Flexible Pay-Per-Response</li>
                            <li>Priority Support</li>
                            <li>All Features</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    <p className="text-l text-center">
                      Contact{" "}
                      <span className="font-semibold">founders@folo-up.co</span>{" "}
                      to upgrade your plan.
                    </p>
                  </div>
                </Modal>
              )}
              {interviews
                .filter((item) =>
                  (item.name ?? '').toLowerCase().includes(search.toLowerCase())
                )
                .map((item) => (
                  <InterviewCard
                    id={item.id}
                    interviewerId={item.interviewer_id}
                    key={item.id}
                    name={item.name}
                    url={item.url ?? ""}
                    readableSlug={item.readable_slug}
                    variant={viewMode}
                  />
                ))}
              {interviews.filter((item) =>
                (item.name ?? '').toLowerCase().includes(search.toLowerCase())
              ).length === 0 && !interviewsLoading && !loading && (
                <p className="text-sm text-gray-500 py-8">No interviews match your search.</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create Interview Modal */}
      <Modal
        open={isCreateModalOpen}
        closeOnOutsideClick={false}
        onClose={() => setIsCreateModalOpen(false)}
      >
        <CreateInterviewModal open={isCreateModalOpen} setOpen={setIsCreateModalOpen} />
      </Modal>
    </main>
  );
}

export default Interviews;
