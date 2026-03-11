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
import { Gem, Plus } from "lucide-react";
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              My Interviews
            </h2>
            <h3 className="text-sm tracking-tight text-gray-600 font-medium">
              Start getting responses now!
            </h3>
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
        <div className="flex flex-wrap gap-4">
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
              {interviews.map((item) => (
                <InterviewCard
                  id={item.id}
                  interviewerId={item.interviewer_id}
                  key={item.id}
                  name={item.name}
                  url={item.url ?? ""}
                  readableSlug={item.readable_slug}
                />
              ))}
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
