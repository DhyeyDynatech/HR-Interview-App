"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import CreateInterviewModal from "@/components/dashboard/interview/createInterviewModal";
import Modal from "@/components/dashboard/Modal";

function CreateInterviewCard() {
  const [open, setOpen] = useState(false);


  return (
    <>
      <Card
        className="flex items-center border-dashed border-gray-400 border-2 cursor-pointer hover:border-gray-500 hover:bg-gray-50 transition-all h-44 w-full rounded-lg overflow-hidden"
        onClick={() => {
          setOpen(true);
        }}
      >
        <CardContent className="flex items-center flex-col mx-auto py-4">
          <div className="flex flex-col justify-center items-center w-full overflow-hidden">
            <Plus size={48} strokeWidth={1} className="text-gray-500" />
          </div>
          <CardTitle className="p-0 text-sm text-center text-gray-600 mt-2">
            Create an Interview
          </CardTitle>
        </CardContent>
      </Card>
      <Modal
        open={open}
        closeOnOutsideClick={false}
        onClose={() => {
          setOpen(false);
        }}
      >
        <CreateInterviewModal open={open} setOpen={setOpen} />
      </Modal>
    </>
  );
}

export default CreateInterviewCard;
