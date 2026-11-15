import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "react-query";
import ManageHotelForm from "../forms/ManageHotelForm";
import { ErrorState, PageSpinner } from "../components/Spinner";
import { useAppContext } from "../contexts/AppContext";
import { fetchMyHotelById, updateMyHotel } from "../lib/api";
import { errorMessage } from "../lib/utils";

const EditHotel = () => {
  const { hotelId = "" } = useParams();
  const { showToast } = useAppContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: hotel, isLoading, isError, error } = useQuery(["my-hotel", hotelId], () => fetchMyHotelById(hotelId));
  const mutation = useMutation((form: FormData) => updateMyHotel(hotelId, form), {
    onSuccess: (updated) => {
      showToast({ title: "Changes saved", description: updated.name });
      queryClient.invalidateQueries("my-hotels");
      queryClient.invalidateQueries(["hotel", hotelId]);
      queryClient.invalidateQueries(["my-hotel", hotelId]);
      navigate("/my-hotels");
    },
    onError: (e) => showToast({ title: "Could not save changes", description: errorMessage(e), type: "error" }),
  });

  if (isLoading) return <PageSpinner label="Loading hotel..." />;
  if (isError || !hotel) return <div className="container-page py-12"><ErrorState message={errorMessage(error, "Hotel not found")} /></div>;

  return (
    <div className="container-page max-w-4xl py-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Edit {hotel.name}</h1>
      <p className="mt-1 mb-6 text-slate-600">Update details, prices and photos.</p>
      <ManageHotelForm hotel={hotel} submitLabel="Save changes" isSaving={mutation.isLoading} onSave={(form) => mutation.mutate(form)} />
    </div>
  );
};

export default EditHotel;
