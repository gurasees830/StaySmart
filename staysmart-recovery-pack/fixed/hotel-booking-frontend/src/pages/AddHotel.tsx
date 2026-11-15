import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "react-query";
import ManageHotelForm from "../forms/ManageHotelForm";
import { useAppContext } from "../contexts/AppContext";
import { addMyHotel } from "../lib/api";
import { errorMessage } from "../lib/utils";

const AddHotel = () => {
  const { showToast } = useAppContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation(addMyHotel, {
    onSuccess: (hotel) => {
      showToast({ title: "Hotel added", description: `${hotel.name} is now live on StaySmart.` });
      queryClient.invalidateQueries("my-hotels");
      navigate("/my-hotels");
    },
    onError: (error) => showToast({ title: "Could not add hotel", description: errorMessage(error), type: "error" }),
  });

  return (
    <div className="container-page max-w-4xl py-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">List your property</h1>
      <p className="mt-1 mb-6 text-slate-600">Add your hotel, guest house or homestay. It will appear in search right away.</p>
      <ManageHotelForm submitLabel="Publish property" isSaving={mutation.isLoading} onSave={(form) => mutation.mutate(form)} />
    </div>
  );
};

export default AddHotel;
